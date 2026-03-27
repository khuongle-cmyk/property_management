import { NextResponse } from "next/server";
import { userCanManageLeadPipeline } from "@/lib/auth/crm-lead-access";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Body = { leadId?: string; lostReason?: string };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leadId = body.leadId?.trim();
  const lostReason = body.lostReason?.trim() || "other";
  if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 });

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

  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, tenant_id, pipeline_owner, archived")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const allowed = await userCanManageLeadPipeline(supabase, user.id, {
    tenant_id: lead.tenant_id as string,
    pipeline_owner: lead.pipeline_owner as string,
  });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const allowedReasons = [
    "price_too_high",
    "space_too_small",
    "space_too_large",
    "chose_competitor",
    "no_longer_needed",
    "other",
  ];
  const reason = allowedReasons.includes(lostReason) ? lostReason : "other";

  const { data: propRows } = await admin.from("room_proposals").select("id").eq("lead_id", leadId);
  const proposalIds = (propRows ?? []).map((r: { id: string }) => r.id);

  let roomIds: string[] = [];
  if (proposalIds.length) {
    const { data: itemRows } = await admin.from("room_proposal_items").select("space_id").in("proposal_id", proposalIds);
    roomIds = [...new Set((itemRows ?? []).map((r: { space_id: string }) => r.space_id))];
  }

  await admin
    .from("room_proposals")
    .update({ status: "rejected" })
    .eq("lead_id", leadId)
    .in("status", ["draft", "sent", "negotiating"]);

  for (const rid of roomIds) {
    await admin.from("bookable_spaces").update({ space_status: "available" }).eq("id", rid).eq("space_status", "reserved");
  }

  await admin.from("room_contracts").update({ status: "cancelled" }).eq("lead_id", leadId).in("status", ["draft"]);

  const { error: leadUpdErr } = await admin
    .from("leads")
    .update({
      stage: "lost",
      lost_reason: reason,
      archived: true,
      won_room_id: null,
      won_proposal_id: null,
      won_client_tenant_id: null,
      won_at: null,
    })
    .eq("id", leadId);
  if (leadUpdErr) return NextResponse.json({ error: leadUpdErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
