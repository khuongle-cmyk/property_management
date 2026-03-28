import { NextResponse } from "next/server";
import { userCanManageLeadPipeline } from "@/lib/auth/crm-lead-access";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Body = { contractTerms?: string | null };

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const contractId = id?.trim();
  if (!contractId) return NextResponse.json({ error: "Missing contract id" }, { status: 400 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
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

  const { data: contract, error: cErr } = await admin
    .from("room_contracts")
    .select("id, lead_id, status")
    .eq("id", contractId)
    .maybeSingle();
  if (cErr || !contract?.lead_id) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  if (contract.status !== "draft") {
    return NextResponse.json({ error: "Only draft contracts can be edited" }, { status: 400 });
  }

  const { data: lead } = await admin
    .from("leads")
    .select("tenant_id, pipeline_owner")
    .eq("id", contract.lead_id)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const allowed = await userCanManageLeadPipeline(supabase, user.id, {
    tenant_id: lead.tenant_id as string,
    pipeline_owner: lead.pipeline_owner as string,
  });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { error: uErr } = await admin
    .from("room_contracts")
    .update({ contract_terms: body.contractTerms ?? null })
    .eq("id", contractId)
    .eq("status", "draft");
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
