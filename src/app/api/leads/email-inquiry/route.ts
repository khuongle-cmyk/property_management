import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendLeadCreatedEmails } from "@/lib/leads-email";

type Body = {
  fromEmail?: string;
  fromName?: string;
  company?: string;
  phone?: string;
  subject?: string;
  message?: string;
  tenantId?: string;
  propertyId?: string;
  toEmail?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fromEmail = (body.fromEmail ?? "").trim().toLowerCase();
  const fromName = (body.fromName ?? "").trim() || "Unknown sender";
  if (!fromEmail) return NextResponse.json({ error: "fromEmail is required" }, { status: 400 });

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Server configuration error" }, { status: 500 });
  }

  const propertyId = (body.propertyId ?? "").trim() || null;
  let tenantId = (body.tenantId ?? "").trim() || process.env.DEFAULT_LEAD_TENANT_ID?.trim() || null;
  const toEmail = (body.toEmail ?? process.env.SALES_INBOX_ADDRESS ?? "sales@villageworks.com").trim().toLowerCase();
  let pipelineOwner = "platform";
  if (!tenantId && propertyId) {
    const { data } = await admin.from("properties").select("tenant_id").eq("id", propertyId).maybeSingle();
    tenantId = (data?.tenant_id as string | undefined) ?? null;
  }
  if (!tenantId) return NextResponse.json({ error: "tenantId is required if no DEFAULT_LEAD_TENANT_ID is configured" }, { status: 400 });

  if (toEmail !== (process.env.SALES_INBOX_ADDRESS ?? "sales@villageworks.com").trim().toLowerCase()) {
    const { data: settings } = await admin
      .from("crm_pipeline_settings")
      .select("tenant_id, enabled")
      .eq("inbound_email", toEmail)
      .maybeSingle();
    if (settings?.enabled) {
      tenantId = settings.tenant_id as string;
      pipelineOwner = tenantId;
    }
  }

  const companyName = (body.company ?? "").trim() || "Unknown company";
  const noteParts = [body.subject ? `Subject: ${body.subject}` : "", body.message ? `Message: ${body.message}` : ""]
    .filter(Boolean)
    .join("\n");

  const { data: created, error } = await admin
    .from("leads")
    .insert({
      tenant_id: tenantId,
      pipeline_owner: pipelineOwner,
      property_id: propertyId,
      company_name: companyName,
      contact_person_name: fromName,
      email: fromEmail,
      phone: (body.phone ?? "").trim() || null,
      source: "email",
      notes: noteParts || "Lead created from email inquiry",
    })
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await sendLeadCreatedEmails(admin, tenantId, {
    companyName,
    contactName: fromName,
    email: fromEmail,
    phone: (body.phone ?? "").trim() || null,
    source: "email",
    message: noteParts,
  });

  return NextResponse.json({ ok: true, leadId: created?.id ?? null });
}

