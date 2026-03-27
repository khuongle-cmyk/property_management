import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendLeadCreatedEmails } from "@/lib/leads-email";

type InboundPayload = {
  from?: string;
  fromEmail?: string;
  fromName?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
};

function parseEmailAndName(raw: string): { name: string; email: string } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*)<([^>]+)>$/);
  if (!match) return { name: "Unknown sender", email: trimmed.toLowerCase() };
  const name = match[1].trim().replace(/^"|"$/g, "") || "Unknown sender";
  const email = match[2].trim().toLowerCase();
  return { name, email };
}

function guessCompanyFromText(text: string): string | null {
  const patterns = [/company\s*:\s*([^\n\r]+)/i, /from\s+([A-Za-z0-9 .&-]{2,})/i];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

export async function POST(req: Request) {
  const configuredSecret = process.env.RESEND_INBOUND_WEBHOOK_SECRET?.trim();
  if (configuredSecret) {
    const sentSecret = req.headers.get("x-webhook-secret")?.trim();
    if (!sentSecret || sentSecret !== configuredSecret) {
      return NextResponse.json({ error: "Unauthorized webhook" }, { status: 401 });
    }
  }

  let body: InboundPayload;
  try {
    body = (await req.json()) as InboundPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const toAddress = (body.to ?? "").toLowerCase();
  const salesInbox = (process.env.SALES_INBOX_ADDRESS ?? "sales@villageworks.com").trim().toLowerCase();
  const fromRaw = body.from ?? body.fromEmail ?? "";
  const sender = parseEmailAndName(fromRaw);
  if (!sender.email) return NextResponse.json({ error: "Missing sender email" }, { status: 400 });

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Server configuration error" }, { status: 500 });
  }

  let tenantId = process.env.DEFAULT_LEAD_TENANT_ID?.trim() || null;
  let pipelineOwner = "platform";
  if (toAddress && toAddress !== salesInbox) {
    const { data: settings } = await admin
      .from("crm_pipeline_settings")
      .select("tenant_id, enabled")
      .eq("inbound_email", toAddress)
      .maybeSingle();
    if (settings?.enabled) {
      tenantId = settings.tenant_id as string;
      pipelineOwner = tenantId;
    }
  }

  if (!tenantId) return NextResponse.json({ error: "DEFAULT_LEAD_TENANT_ID is required for platform inbound emails" }, { status: 400 });

  const textBody = (body.text ?? "").trim() || (body.html ?? "").replace(/<[^>]+>/g, " ").trim();
  const company = guessCompanyFromText(textBody) || "Unknown company";
  const noteParts = [body.subject ? `Subject: ${body.subject}` : "", textBody ? `Message: ${textBody}` : ""]
    .filter(Boolean)
    .join("\n\n");

  const { data: created, error } = await admin
    .from("leads")
    .insert({
      tenant_id: tenantId,
      pipeline_owner: pipelineOwner,
      company_name: company,
      contact_person_name: body.fromName?.trim() || sender.name,
      email: sender.email,
      source: "email",
      notes: noteParts || "Lead created from inbound email webhook",
    })
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await sendLeadCreatedEmails(admin, tenantId, {
    companyName: company,
    contactName: body.fromName?.trim() || sender.name,
    email: sender.email,
    source: "email",
    message: noteParts,
  });

  return NextResponse.json({ ok: true, leadId: created?.id ?? null });
}

