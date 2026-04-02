import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendLeadCreatedEmails } from "@/lib/leads-email";

type Body = {
  name?: string;
  email?: string;
  company?: string;
  yTunnus?: string;
  y_tunnus?: string;
  interestedSpaceType?: string;
  approxSizeM2?: number | string;
  approxBudgetEurMonth?: number | string;
  preferredMoveInDate?: string;
  propertyId?: string;
  pipelineSlug?: string;
};

function normalizeOptionalYtunnus(raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower === "skip" || t === "-") return null;
  return t;
}

async function resolveTenantId(admin: ReturnType<typeof getSupabaseAdminClient>, propertyId?: string): Promise<string | null> {
  if (propertyId) {
    const { data } = await admin.from("properties").select("tenant_id").eq("id", propertyId).maybeSingle();
    if (data?.tenant_id) return data.tenant_id as string;
  }
  const envTenantId = process.env.DEFAULT_LEAD_TENANT_ID?.trim();
  if (envTenantId) return envTenantId;
  const { data: firstTenant } = await admin.from("tenants").select("id").limit(1).maybeSingle();
  return (firstTenant?.id as string | undefined) ?? null;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  if (!name || !email) {
    return NextResponse.json({ error: "name and email are required" }, { status: 400 });
  }

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Server configuration error" }, { status: 500 });
  }

  const propertyId = (body.propertyId ?? "").trim() || null;
  const pipelineSlug = (body.pipelineSlug ?? "").trim().toLowerCase() || null;
  let tenantId: string | null;
  let pipelineOwner: string;
  if (pipelineSlug) {
    const { data: settings } = await admin
      .from("crm_pipeline_settings")
      .select("tenant_id, enabled")
      .eq("contact_slug", pipelineSlug)
      .maybeSingle();
    if (!settings?.enabled) {
      return NextResponse.json({ error: "This contact pipeline is disabled or invalid." }, { status: 404 });
    }
    tenantId = settings.tenant_id as string;
    pipelineOwner = tenantId;
  } else {
    tenantId = await resolveTenantId(admin, propertyId ?? undefined);
    pipelineOwner = "platform";
  }
  if (!tenantId) return NextResponse.json({ error: "Unable to resolve tenant for lead" }, { status: 400 });

  const approxSize = body.approxSizeM2 == null ? null : Number(body.approxSizeM2);
  const approxBudget = body.approxBudgetEurMonth == null ? null : Number(body.approxBudgetEurMonth);
  const moveIn = (body.preferredMoveInDate ?? "").trim() || null;
  const company = (body.company ?? "").trim() || "Individual";
  const interestedSpaceType = (body.interestedSpaceType ?? "").trim() || null;
  const yTunnusVal = normalizeOptionalYtunnus(body.yTunnus ?? body.y_tunnus);

  const { data: created, error } = await admin
    .from("leads")
    .insert({
      tenant_id: tenantId,
      pipeline_owner: pipelineOwner,
      property_id: propertyId,
      company_name: company,
      contact_person_name: name,
      email,
      source: "chatbot",
      y_tunnus: yTunnusVal,
      business_id: yTunnusVal,
      interested_space_type: interestedSpaceType,
      approx_size_m2: Number.isFinite(approxSize) ? approxSize : null,
      approx_budget_eur_month: Number.isFinite(approxBudget) ? approxBudget : null,
      preferred_move_in_date: moveIn,
      notes: "Lead created from chatbot widget",
    })
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await sendLeadCreatedEmails(admin, tenantId, {
    companyName: company,
    contactName: name,
    email,
    source: "chatbot",
    interestedSpaceType,
    approxSizeM2: Number.isFinite(approxSize) ? approxSize : null,
    approxBudgetEurMonth: Number.isFinite(approxBudget) ? approxBudget : null,
    message: yTunnusVal ? `Y-tunnus: ${yTunnusVal}` : null,
  });

  return NextResponse.json({ ok: true, leadId: created?.id ?? null });
}

