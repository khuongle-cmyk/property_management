import { NextResponse } from "next/server";
import { resolveContactPersonName } from "@/lib/crm/finnish-company";
import { leadCompanyFieldsFromBody } from "@/lib/crm/lead-company-payload";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Body = Record<string, unknown> & {
  tenantId?: string;
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
};

const SOURCES = new Set(["email", "website", "phone", "chatbot", "social_media", "referral", "other"]);
const SPACE_TYPES = new Set(["office", "meeting_room", "venue", "hot_desk"]);

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tenantId = (body.tenantId ?? "").trim();
  const company = (body.company_name ?? "").trim();
  const contact = resolveContactPersonName({
    contact_person_name: body.contact_person_name as string | undefined,
    contact_name: body.contact_name as string | undefined,
    contact_first_name: body.contact_first_name as string | undefined,
    contact_last_name: body.contact_last_name as string | undefined,
  }).trim();
  const email = (body.email ?? "").trim().toLowerCase();
  if (!tenantId || !company || !contact || !email) {
    return NextResponse.json(
      { error: "tenantId, company_name, email, and contact name (or first + last name) are required" },
      { status: 400 }
    );
  }

  const source = (body.source ?? "other").trim().toLowerCase();
  if (!SOURCES.has(source)) {
    return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  }

  let spaceType: string | null = (body.interested_space_type ?? "").trim() || null;
  if (spaceType && !SPACE_TYPES.has(spaceType)) {
    return NextResponse.json({ error: "Invalid interested_space_type" }, { status: 400 });
  }
  if (!spaceType) spaceType = null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: memberships } = await supabase.from("memberships").select("role, tenant_id").eq("user_id", user.id);
  const canCreate = (memberships ?? []).some((m) => {
    const role = (m.role ?? "").toLowerCase();
    return (
      role === "super_admin" ||
      (m.tenant_id === tenantId && (role === "owner" || role === "manager" || role === "agent"))
    );
  });
  if (!canCreate) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const pid = (body.property_id ?? "").trim() || null;

  const companyCols = leadCompanyFieldsFromBody(body as Record<string, unknown>);

  const { data, error } = await supabase
    .from("leads")
    .insert({
      tenant_id: tenantId,
      pipeline_owner: tenantId,
      property_id: pid,
      company_name: company,
      contact_person_name: contact,
      email,
      phone: (body.phone ?? "").toString().trim() || null,
      source,
      interested_space_type: spaceType,
      approx_size_m2: body.approx_size_m2 ?? null,
      approx_budget_eur_month: body.approx_budget_eur_month ?? null,
      preferred_move_in_date: (body.preferred_move_in_date ?? "").trim() || null,
      notes: body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null,
      assigned_agent_user_id: user.id,
      created_by_user_id: user.id,
      stage: "new",
      ...companyCols,
    })
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data?.id ?? null });
}
