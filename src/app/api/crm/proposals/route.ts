import { NextResponse } from "next/server";
import { sumProposalMonthlyRent, validateProposalItems, type ProposalItemInput } from "@/lib/crm/proposal-items";
import { userCanManageLeadPipeline } from "@/lib/auth/crm-lead-access";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Body = {
  leadId?: string;
  items?: ProposalItemInput[];
  proposedStartDate?: string;
  leaseLengthMonths?: number | null;
  specialConditions?: string | null;
  validUntil?: string;
  status?: "draft" | "sent";
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leadId = body.leadId?.trim();
  const vItems = validateProposalItems(body.items);
  if (vItems) {
    return NextResponse.json({ error: vItems }, { status: 400 });
  }
  const items = body.items as ProposalItemInput[];

  if (!leadId || !body.proposedStartDate?.trim() || !body.validUntil?.trim()) {
    return NextResponse.json(
      { error: "leadId, items, proposedStartDate, validUntil are required" },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Server misconfigured" }, { status: 500 });
  }

  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, tenant_id, pipeline_owner, property_id, company_name, contact_person_name, email, archived")
    .eq("id", leadId)
    .maybeSingle();

  if (leadErr || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (lead.archived) return NextResponse.json({ error: "Lead is archived" }, { status: 400 });

  const allowed = await userCanManageLeadPipeline(supabase, user.id, {
    tenant_id: lead.tenant_id as string,
    pipeline_owner: lead.pipeline_owner as string,
  });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const spaceIds = [...new Set(items.map((i) => i.spaceId.trim()))];
  const { data: spaces, error: spErr } = await admin
    .from("bookable_spaces")
    .select("id, property_id")
    .in("id", spaceIds);
  if (spErr || !spaces?.length || spaces.length !== spaceIds.length) {
    return NextResponse.json({ error: "One or more rooms not found" }, { status: 404 });
  }

  const propertyIds = [...new Set(spaces.map((s) => s.property_id as string))];
  if (propertyIds.length !== 1) {
    return NextResponse.json({ error: "All rooms in a proposal must belong to the same property" }, { status: 400 });
  }
  const propertyId = propertyIds[0];

  const { data: prop } = await admin.from("properties").select("id, tenant_id").eq("id", propertyId).maybeSingle();
  if (!prop) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  if (lead.property_id && prop.id !== lead.property_id) {
    return NextResponse.json({ error: "Rooms must belong to the lead's property" }, { status: 400 });
  }
  if (!lead.property_id && prop.tenant_id !== lead.tenant_id) {
    return NextResponse.json({ error: "Rooms must belong to the lead's organization" }, { status: 400 });
  }

  const leaseMonths =
    body.leaseLengthMonths != null && Number.isFinite(body.leaseLengthMonths)
      ? Math.max(1, Math.floor(body.leaseLengthMonths))
      : null;
  const status = body.status === "draft" ? "draft" : "sent";

  const { data: created, error: insErr } = await admin
    .from("room_proposals")
    .insert({
      property_id: propertyId,
      lead_id: leadId,
      tenant_company_name: lead.company_name,
      contact_person: lead.contact_person_name,
      proposed_start_date: body.proposedStartDate,
      lease_length_months: leaseMonths,
      special_conditions: body.specialConditions?.trim() || null,
      valid_until: body.validUntil,
      status,
    })
    .select("id")
    .maybeSingle();

  if (insErr || !created?.id) return NextResponse.json({ error: insErr?.message ?? "Insert failed" }, { status: 400 });

  const proposalId = created.id as string;

  const rows = items.map((it) => {
    const m = it.proposedMonthlyRent != null ? Number(it.proposedMonthlyRent) : null;
    const h = it.proposedHourlyRate != null ? Number(it.proposedHourlyRate) : null;
    return {
      proposal_id: proposalId,
      space_id: it.spaceId.trim(),
      proposed_monthly_rent: m != null && Number.isFinite(m) ? m : null,
      proposed_hourly_rate: h != null && Number.isFinite(h) ? h : null,
      notes: it.notes?.trim() || null,
    };
  });

  const { error: itemsErr } = await admin.from("room_proposal_items").insert(rows);
  if (itemsErr) {
    await admin.from("room_proposals").delete().eq("id", proposalId);
    return NextResponse.json({ error: itemsErr.message }, { status: 400 });
  }

  const totalMo = sumProposalMonthlyRent(rows.map((r) => ({ proposed_monthly_rent: r.proposed_monthly_rent })));

  await admin.from("lead_activities").insert({
    lead_id: leadId,
    activity_type: "offer_sent",
    actor_user_id: user.id,
    summary: "Room proposal created",
    details: `Proposal ${proposalId} with ${rows.length} space(s); ~€${totalMo}/mo recurring`,
    metadata: { proposal_id: proposalId, space_ids: spaceIds },
  });

  return NextResponse.json({ ok: true, proposalId });
}
