import { NextResponse } from "next/server";
import { sumProposalMonthlyRent } from "@/lib/crm/proposal-items";
import { userCanManageLeadPipeline } from "@/lib/auth/crm-lead-access";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Body = { sourceProposalId?: string };

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

  const sourceProposalId = body.sourceProposalId?.trim();
  if (!sourceProposalId) return NextResponse.json({ error: "sourceProposalId is required" }, { status: 400 });

  const supabase = createSupabaseServerClient();
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

  const { data: proposal, error: pErr } = await admin.from("room_proposals").select("*").eq("id", sourceProposalId).maybeSingle();
  if (pErr || !proposal?.lead_id) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });

  const { data: lead } = await admin
    .from("leads")
    .select("tenant_id, pipeline_owner, archived")
    .eq("id", proposal.lead_id)
    .maybeSingle();
  if (!lead || lead.archived) return NextResponse.json({ error: "Lead not available" }, { status: 400 });

  const allowed = await userCanManageLeadPipeline(supabase, user.id, {
    tenant_id: lead.tenant_id as string,
    pipeline_owner: lead.pipeline_owner as string,
  });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: pItems, error: piErr } = await admin
    .from("room_proposal_items")
    .select("*")
    .eq("proposal_id", sourceProposalId);
  if (piErr) return NextResponse.json({ error: piErr.message }, { status: 400 });
  if (!pItems?.length) return NextResponse.json({ error: "Proposal has no room line items" }, { status: 400 });

  const { data: latest } = await admin
    .from("room_contracts")
    .select("*")
    .eq("source_proposal_id", sourceProposalId)
    .order("negotiation_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (latest?.negotiation_version ?? 0) + 1;
  const terms = (latest?.contract_terms as string | null) ?? (proposal.special_conditions as string | null);

  if (latest?.status === "draft" && latest.id) {
    await admin.from("room_contracts").update({ status: "cancelled" }).eq("id", latest.id);
  }

  const { data: property } = await admin.from("properties").select("tenant_id").eq("id", proposal.property_id).maybeSingle();
  const landlordTenantId = property?.tenant_id as string | undefined;
  if (!landlordTenantId) return NextResponse.json({ error: "Property not found" }, { status: 400 });

  const endDate = endDateFromLease(
    proposal.proposed_start_date as string,
    proposal.lease_length_months as number | null
  );

  const monthlySum = sumProposalMonthlyRent(pItems);
  const primaryRoomId = (pItems[0] as { space_id: string }).space_id;

  const { data: ins, error: insErr } = await admin
    .from("room_contracts")
    .insert({
      room_id: primaryRoomId,
      property_id: proposal.property_id,
      tenant_id: landlordTenantId,
      lead_id: proposal.lead_id,
      monthly_rent: monthlySum,
      start_date: proposal.proposed_start_date,
      end_date: endDate,
      status: "draft",
      source_proposal_id: sourceProposalId,
      negotiation_version: nextVersion,
      contract_terms: terms,
    })
    .select("id")
    .maybeSingle();

  if (insErr || !ins) return NextResponse.json({ error: insErr?.message ?? "Insert failed" }, { status: 400 });

  const { error: liErr } = await admin.from("room_contract_items").insert(
    pItems.map((it: { space_id: string; proposed_monthly_rent?: unknown; proposed_hourly_rate?: unknown; notes?: unknown }) => ({
      contract_id: ins.id,
      space_id: it.space_id,
      monthly_rent: Number(it.proposed_monthly_rent) || 0,
      hourly_rate: it.proposed_hourly_rate != null ? Number(it.proposed_hourly_rate) : null,
      notes: (it.notes as string | null) ?? null,
    }))
  );
  if (liErr) return NextResponse.json({ error: liErr.message }, { status: 400 });

  await admin.from("lead_activities").insert({
    lead_id: proposal.lead_id as string,
    activity_type: "document_shared",
    actor_user_id: user.id,
    summary: `Contract draft v${nextVersion}`,
    details: `New negotiation version for proposal ${sourceProposalId}`,
  });

  return NextResponse.json({ ok: true, contractId: ins.id, version: nextVersion });
}
