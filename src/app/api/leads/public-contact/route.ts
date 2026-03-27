import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendLeadCreatedEmails } from "@/lib/leads-email";

type Body = {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  interestedSpaceType?: string;
  message?: string;
  propertyId?: string;
  pipelineSlug?: string;
};

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

  const contactName = (body.name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const phone = (body.phone ?? "").trim() || null;
  const companyName = (body.company ?? "").trim() || "Individual";
  const interestedSpaceType = (body.interestedSpaceType ?? "").trim() || null;
  const notes = (body.message ?? "").trim() || null;
  const propertyId = (body.propertyId ?? "").trim() || null;
  const pipelineSlug = (body.pipelineSlug ?? "").trim().toLowerCase() || null;

  if (!contactName || !email) {
    return NextResponse.json({ error: "name and email are required" }, { status: 400 });
  }

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Server configuration error" }, { status: 500 });
  }

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

  const payload = {
    tenant_id: tenantId,
    pipeline_owner: pipelineOwner,
    property_id: propertyId,
    company_name: companyName,
    contact_person_name: contactName,
    email,
    phone,
    source: "website",
    interested_space_type: interestedSpaceType,
    notes,
  };

  const { data: created, error } = await admin.from("leads").insert(payload).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await sendLeadCreatedEmails(admin, tenantId, {
    companyName,
    contactName,
    email,
    phone,
    source: "website",
    interestedSpaceType,
    message: notes,
  });

  return NextResponse.json({ ok: true, leadId: created?.id ?? null });
}

