import { NextResponse } from "next/server";
import { resolveContactPersonName } from "@/lib/crm/finnish-company";
import { leadCompanyPatchFromBody } from "@/lib/crm/lead-company-payload";
import { userCanManageLeadPipeline } from "@/lib/auth/crm-lead-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Body = Record<string, unknown> & {
  company_name?: string;
  contact_person_name?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  email?: string;
  phone?: string | null;
  source?: string;
  property_id?: string | null;
  interested_space_type?: string | null;
  approx_size_m2?: number | null;
  approx_budget_eur_month?: number | null;
  preferred_move_in_date?: string | null;
  notes?: string | null;
  assigned_agent_user_id?: string | null;
};

const SOURCES = new Set(["email", "website", "phone", "chatbot", "social_media", "referral", "other"]);
const SPACE_TYPES = new Set(["office", "meeting_room", "venue", "hot_desk"]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leadId = id?.trim();
  if (!leadId) return NextResponse.json({ error: "Missing lead id" }, { status: 400 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: lead, error: lErr } = await supabase
    .from("leads")
    .select("id, tenant_id, pipeline_owner, assigned_agent_user_id")
    .eq("id", leadId)
    .maybeSingle();
  if (lErr || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const { data: mem } = await supabase.from("memberships").select("role, tenant_id").eq("user_id", user.id);
  const isAssignedAgent = (mem ?? []).some((m) => {
    const role = (m.role ?? "").toLowerCase();
    return role === "agent" && m.tenant_id === lead.tenant_id && lead.assigned_agent_user_id === user.id;
  });

  const allowed =
    isAssignedAgent ||
    (await userCanManageLeadPipeline(supabase, user.id, {
      tenant_id: lead.tenant_id as string,
      pipeline_owner: lead.pipeline_owner as string,
    }));
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const patch: Record<string, unknown> = {};
  if (body.company_name !== undefined) patch.company_name = (body.company_name ?? "").trim();
  if (
    body.contact_person_name !== undefined ||
    body.contact_first_name !== undefined ||
    body.contact_last_name !== undefined
  ) {
    patch.contact_person_name = resolveContactPersonName({
      contact_person_name: body.contact_person_name as string | undefined,
      contact_first_name: body.contact_first_name as string | undefined,
      contact_last_name: body.contact_last_name as string | undefined,
    }).trim();
  }
  if (body.email !== undefined) patch.email = (body.email ?? "").trim().toLowerCase();
  if (body.phone !== undefined) patch.phone = (body.phone ?? "").toString().trim() || null;
  if (body.source !== undefined) {
    const source = (body.source ?? "other").trim().toLowerCase();
    if (!SOURCES.has(source)) return NextResponse.json({ error: "Invalid source" }, { status: 400 });
    patch.source = source;
  }
  if (body.property_id !== undefined) {
    const pid = (body.property_id ?? "").trim();
    patch.property_id = pid || null;
  }
  if (body.interested_space_type !== undefined) {
    const st = (body.interested_space_type ?? "").trim();
    if (st && !SPACE_TYPES.has(st)) return NextResponse.json({ error: "Invalid interested_space_type" }, { status: 400 });
    patch.interested_space_type = st || null;
  }
  if (body.approx_size_m2 !== undefined) patch.approx_size_m2 = body.approx_size_m2;
  if (body.approx_budget_eur_month !== undefined) patch.approx_budget_eur_month = body.approx_budget_eur_month;
  if (body.preferred_move_in_date !== undefined) {
    patch.preferred_move_in_date = (body.preferred_move_in_date ?? "").trim() || null;
  }
  if (body.notes !== undefined) {
    patch.notes = body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null;
  }
  if (body.assigned_agent_user_id !== undefined) {
    const aid = (body.assigned_agent_user_id ?? "").trim();
    patch.assigned_agent_user_id = aid || null;
  }

  Object.assign(patch, leadCompanyPatchFromBody(body as Record<string, unknown>));

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error: uErr } = await supabase.from("leads").update(patch).eq("id", leadId);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
