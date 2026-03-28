import { NextResponse } from "next/server";
import { sumProposalMonthlyRent } from "@/lib/crm/proposal-items";
import { userCanManageLeadPipeline } from "@/lib/auth/crm-lead-access";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createOnboardingTasksFromContract } from "@/lib/tasks/automation";

type Body = { leadId?: string; proposalId?: string };

function endDateFromLease(startIso: string, months: number | null): string {
  const m = months != null && months > 0 ? months : 12;
  const d = new Date(startIso + "T12:00:00");
  d.setMonth(d.getMonth() + m);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leadId = body.leadId?.trim();
  const proposalId = body.proposalId?.trim();
  if (!leadId || !proposalId) {
    return NextResponse.json({ error: "leadId and proposalId are required" }, { status: 400 });
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
    .select("id, tenant_id, pipeline_owner, company_name, contact_person_name, email, archived, stage")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (lead.archived) return NextResponse.json({ error: "Lead is archived" }, { status: 400 });

  const allowed = await userCanManageLeadPipeline(supabase, user.id, {
    tenant_id: lead.tenant_id as string,
    pipeline_owner: lead.pipeline_owner as string,
  });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: proposal, error: propErr } = await admin.from("room_proposals").select("*").eq("id", proposalId).maybeSingle();
  if (propErr || !proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  if (proposal.lead_id !== leadId) {
    return NextResponse.json({ error: "Proposal does not belong to this lead" }, { status: 400 });
  }
  if (["accepted", "rejected"].includes(proposal.status as string)) {
    return NextResponse.json({ error: "Proposal is already closed" }, { status: 400 });
  }

  const { data: winItems, error: wiErr } = await admin
    .from("room_proposal_items")
    .select("*")
    .eq("proposal_id", proposalId);
  if (wiErr) return NextResponse.json({ error: wiErr.message }, { status: 400 });
  if (!winItems?.length) {
    return NextResponse.json({ error: "Proposal has no rooms; add line items first" }, { status: 400 });
  }

  const { data: property } = await admin.from("properties").select("tenant_id").eq("id", proposal.property_id).maybeSingle();
  const landlordTenantId = property?.tenant_id as string | undefined;
  if (!landlordTenantId) return NextResponse.json({ error: "Property not found" }, { status: 400 });

  const { data: losingProposals } = await admin
    .from("room_proposals")
    .select("id")
    .eq("lead_id", leadId)
    .neq("id", proposalId)
    .in("status", ["draft", "sent", "negotiating"]);

  const losingIds = (losingProposals ?? []).map((r: { id: string }) => r.id);
  let releaseSpaceIds: string[] = [];
  if (losingIds.length) {
    const { data: loseItems } = await admin.from("room_proposal_items").select("space_id").in("proposal_id", losingIds);
    releaseSpaceIds = [...new Set((loseItems ?? []).map((x: { space_id: string }) => x.space_id))];
  }

  await admin
    .from("room_proposals")
    .update({ status: "rejected" })
    .eq("lead_id", leadId)
    .neq("id", proposalId)
    .in("status", ["draft", "sent", "negotiating"]);

  await admin.from("room_proposals").update({ status: "accepted" }).eq("id", proposalId);

  for (const rid of releaseSpaceIds) {
    await admin.from("bookable_spaces").update({ space_status: "available" }).eq("id", rid).eq("space_status", "reserved");
  }

  const winSpaceIds = [...new Set(winItems.map((x: { space_id: string }) => x.space_id))];
  for (const rid of winSpaceIds) {
    await admin.from("bookable_spaces").update({ space_status: "reserved" }).eq("id", rid);
  }

  const monthlyTotal = sumProposalMonthlyRent(winItems);
  const primaryRoomId = winItems[0].space_id as string;

  const endDate = endDateFromLease(
    proposal.proposed_start_date as string,
    proposal.lease_length_months as number | null
  );

  const { data: draftContract } = await admin
    .from("room_contracts")
    .select("id")
    .eq("source_proposal_id", proposalId)
    .eq("status", "draft")
    .order("negotiation_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  let contractId = draftContract?.id as string | undefined;
  if (!contractId) {
    const { data: ins, error: insErr } = await admin
      .from("room_contracts")
      .insert({
        room_id: primaryRoomId,
        property_id: proposal.property_id,
        tenant_id: landlordTenantId,
        lead_id: leadId,
        monthly_rent: monthlyTotal,
        start_date: proposal.proposed_start_date,
        end_date: endDate,
        status: "draft",
        source_proposal_id: proposalId,
        negotiation_version: 1,
        contract_terms: (proposal.special_conditions as string | null) ?? null,
      })
      .select("id")
      .maybeSingle();
    if (insErr || !ins) return NextResponse.json({ error: insErr?.message ?? "Contract insert failed" }, { status: 400 });
    contractId = ins.id as string;
  }

  await admin.from("room_contracts").update({ status: "cancelled" }).eq("lead_id", leadId).neq("id", contractId).in("status", ["draft"]);

  await admin.from("room_contract_items").delete().eq("contract_id", contractId);

  const { error: lineErr } = await admin.from("room_contract_items").insert(
    winItems.map((it: { space_id: string; proposed_monthly_rent?: unknown; proposed_hourly_rate?: unknown; notes?: unknown }) => ({
      contract_id: contractId,
      space_id: it.space_id,
      monthly_rent: Number(it.proposed_monthly_rent) || 0,
      hourly_rate: it.proposed_hourly_rate != null ? Number(it.proposed_hourly_rate) : null,
      notes: (it.notes as string | null) ?? null,
    }))
  );
  if (lineErr) return NextResponse.json({ error: lineErr.message }, { status: 400 });

  const signed = new Date().toISOString().slice(0, 10);
  const { error: finErr } = await admin
    .from("room_contracts")
    .update({
      status: "active",
      signed_date: signed,
      end_date: endDate,
      monthly_rent: monthlyTotal,
      start_date: proposal.proposed_start_date,
      room_id: primaryRoomId,
    })
    .eq("id", contractId);
  if (finErr) return NextResponse.json({ error: finErr.message }, { status: 400 });

  const clientBaseName = `${lead.company_name} (Client ${lead.id.slice(0, 8)})`;
  let clientTenantId: string;
  const { data: clientTenant, error: ctErr } = await admin
    .from("tenants")
    .insert({ name: clientBaseName, contact_email: (lead.email as string) ?? null })
    .select("id")
    .maybeSingle();
  if (ctErr) {
    const suffix = `-${Math.random().toString(36).slice(2, 8)}`;
    const { data: retry, error: ctErr2 } = await admin
      .from("tenants")
      .insert({ name: clientBaseName + suffix, contact_email: (lead.email as string) ?? null })
      .select("id")
      .maybeSingle();
    if (ctErr2 || !retry) return NextResponse.json({ error: ctErr2?.message ?? "Could not create leasing client org" }, { status: 400 });
    clientTenantId = retry.id as string;
  } else {
    clientTenantId = clientTenant!.id as string;
  }

  const { error: leadUpdErr } = await admin
    .from("leads")
    .update({
      stage: "won",
      won_room_id: primaryRoomId,
      won_proposal_id: proposalId,
      won_client_tenant_id: clientTenantId,
      won_at: new Date().toISOString(),
      archived: false,
      lost_reason: null,
    })
    .eq("id", leadId);
  if (leadUpdErr) return NextResponse.json({ error: leadUpdErr.message }, { status: 400 });

  await createOnboardingTasksFromContract({
    supabase: admin,
    contractId: contractId!,
    tenantId: landlordTenantId,
    leadId: leadId,
    propertyId: String(proposal.property_id),
    roomId: primaryRoomId,
    contractStartDate: String(proposal.proposed_start_date),
  });

  return NextResponse.json({ ok: true, clientTenantId, contractId });
}
