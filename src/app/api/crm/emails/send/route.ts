import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCrmEmailTenantIds } from "@/lib/email/crm-email-access";
import { logMarketingEmailSent } from "@/lib/email/log-marketing-email";
import { wrapEmailLinksForTracking } from "@/lib/marketing/wrap-links";

function appBaseUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (!u) return "http://localhost:3000";
  return u.startsWith("http") ? u : `https://${u}`;
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

type Body = {
  tenantId?: string;
  leadId?: string;
  to?: string;
  subject?: string;
  preview_text?: string | null;
  body_html?: string;
  from_name?: string;
  from_email?: string;
  reply_to?: string | null;
};

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getCrmEmailTenantIds(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tenantId = (body.tenantId ?? "").trim();
  const leadId = (body.leadId ?? "").trim();
  if (!tenantId || !leadId) return NextResponse.json({ error: "tenantId and leadId are required" }, { status: 400 });

  if (!isSuperAdmin && !tenantIds.includes(tenantId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: lead, error: lErr } = await supabase.from("leads").select("id, tenant_id, email").eq("id", leadId).maybeSingle();
  if (lErr || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const leadRow = lead as { id: string; tenant_id: string; email: string | null };
  if (leadRow.tenant_id !== tenantId) {
    return NextResponse.json({ error: "tenantId must match the lead's organization" }, { status: 400 });
  }

  const toRaw = (body.to ?? leadRow.email ?? "").trim().toLowerCase();
  if (!toRaw || !isValidEmail(toRaw)) {
    return NextResponse.json({ error: "Valid recipient address is required" }, { status: 400 });
  }
  const leadEmail = (leadRow.email ?? "").trim().toLowerCase();
  if (leadEmail && toRaw !== leadEmail) {
    return NextResponse.json({ error: "Recipient must match the lead's email" }, { status: 400 });
  }

  const subject = String(body.subject ?? "").trim();
  const html = String(body.body_html ?? "<p></p>");
  if (!subject) return NextResponse.json({ error: "Subject is required" }, { status: 400 });

  const fromName = String(body.from_name ?? "").trim();
  const fromEmail = String(body.from_email ?? "").trim();
  if (!fromEmail || !isValidEmail(fromEmail)) {
    return NextResponse.json({ error: "Valid from email is required" }, { status: 400 });
  }
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

  const key = process.env.RESEND_API_KEY;
  if (!key) return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 503 });
  const resend = new Resend(key);

  const admin = getSupabaseAdminClient();
  const trackingToken = randomUUID();
  const base = appBaseUrl();
  const unsub = `${base}/api/marketing/unsubscribe?t=${encodeURIComponent(trackingToken)}`;
  const pixel = `${base}/api/marketing/track/open?t=${encodeURIComponent(trackingToken)}`;
  const bodyTracked = wrapEmailLinksForTracking(html, base, trackingToken);
  const fullHtml = `${bodyTracked}<p style="font-size:12px;color:#666"><a href="${unsub}">Unsubscribe</a></p><img src="${pixel}" width="1" height="1" alt="" />`;

  const { error: sErr } = await resend.emails.send({
    from,
    to: toRaw,
    subject,
    replyTo: String(body.reply_to ?? "").trim() || undefined,
    html: fullHtml,
  });

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 502 });

  await logMarketingEmailSent(admin, {
    tenant_id: tenantId,
    subject,
    body_html: html,
    preview_text: body.preview_text != null ? String(body.preview_text) : null,
    from_name: fromName || null,
    from_email: fromEmail,
    reply_to: body.reply_to != null ? String(body.reply_to) : null,
    source: "crm",
    related_id: leadId,
    related_type: "lead",
    recipient_email: toRaw,
    contact_id: leadId,
    tracking_token: trackingToken,
  });

  return NextResponse.json({ ok: true });
}
