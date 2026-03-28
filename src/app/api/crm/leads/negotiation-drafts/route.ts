import { NextResponse } from "next/server";
import { sumProposalMonthlyRent } from "@/lib/crm/proposal-items";
import { userCanManageLeadPipeline } from "@/lib/auth/crm-lead-access";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Body = { leadId?: string };

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
  if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 });

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
    .select("id, tenant_id, pipeline_owner, archived")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (lead.archived) return NextResponse.json({ error: "Lead is archived" }, { status: 400 });

  const allowed = await userCanManageLeadPipeline(supabase, user.id, {
    tenant_id: lead.tenant_id as string,
    pipeline_owner: lead.pipeline_owner as string,
  });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let { data: proposals, error: pErr } = await admin.from("room_proposals").select("*").eq("lead_id", leadId).in("status", ["draft", "sent"]);

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

  if (!proposals?.length) {
    const { data: negPros, error: nErr } = await admin
      .from("room_proposals")
      .select("*")
      .eq("lead_id", leadId)
      .eq("status", "negotiating");
    if (nErr) return NextResponse.json({ error: nErr.message }, { status: 400 });
    if (!negPros?.length) {
      return NextResponse.json({ error: "Create at least one proposal before negotiation" }, { status: 400 });
    }
    proposals = negPros;
  } else {
    await admin.from("room_proposals").update({ status: "negotiating" }).eq("lead_id", leadId).in("status", ["draft", "sent"]);
  }

  const createdIds: string[] = [];

  for (const p of proposals) {
    const { data: existing } = await admin
      .from("room_contracts")
      .select("id")
      .eq("source_proposal_id", p.id)
      .eq("status", "draft")
      .maybeSingle();

    if (existing) continue;

    const { data: property } = await admin.from("properties").select("tenant_id").eq("id", p.property_id).maybeSingle();
    if (!property?.tenant_id) continue;

    const { data: pItems } = await admin.from("room_proposal_items").select("*").eq("proposal_id", p.id);
    if (!pItems?.length) continue;

    const monthlySum = sumProposalMonthlyRent(pItems);
    const primaryRoomId = (pItems[0] as { space_id: string }).space_id;

    const endDate = endDateFromLease(p.proposed_start_date as string, p.lease_length_months as number | null);

    const { data: ins, error: cErr } = await admin
      .from("room_contracts")
      .insert({
        room_id: primaryRoomId,
        property_id: p.property_id,
        tenant_id: property.tenant_id,
        lead_id: leadId,
        monthly_rent: monthlySum,
        start_date: p.proposed_start_date,
        end_date: endDate,
        status: "draft",
        source_proposal_id: p.id,
        negotiation_version: 1,
        contract_terms: (p.special_conditions as string | null) ?? null,
      })
      .select("id")
      .maybeSingle();

    if (cErr || !ins?.id) continue;

    const { error: liErr } = await admin.from("room_contract_items").insert(
      pItems.map((it: { space_id: string; proposed_monthly_rent?: unknown; proposed_hourly_rate?: unknown; notes?: unknown }) => ({
        contract_id: ins.id,
        space_id: it.space_id,
        monthly_rent: Number(it.proposed_monthly_rent) || 0,
        hourly_rate: it.proposed_hourly_rate != null ? Number(it.proposed_hourly_rate) : null,
        notes: (it.notes as string | null) ?? null,
      }))
    );
    if (!liErr) createdIds.push(ins.id as string);
  }

  const { error: stageErr } = await admin
    .from("leads")
    .update({ stage: "negotiation", stage_changed_at: new Date().toISOString() })
    .eq("id", leadId);
  if (stageErr) return NextResponse.json({ error: stageErr.message }, { status: 400 });

  return NextResponse.json({ ok: true, draftContractIds: createdIds });
}
