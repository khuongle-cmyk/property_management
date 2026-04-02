import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { brandEmailFrom, resolveBrandByTenantId } from "@/lib/brand/server";
import { canAccessMarketingRowByTenantId, getMarketingAccess } from "@/lib/marketing/access";
import { wrapEmailLinksForTracking } from "@/lib/marketing/wrap-links";

type Ctx = { params: Promise<{ id: string }> };

function appBaseUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (!u) return "http://localhost:3000";
  return u.startsWith("http") ? u : `https://${u}`;
}

export async function POST(_req: Request, ctx: Ctx) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getMarketingAccess(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const key = process.env.RESEND_API_KEY;
  if (!key) return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 503 });
  const resend = new Resend(key);

  const { id: emailId } = await ctx.params;
  if (!emailId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: em, error: eErr } = await supabase.from("marketing_emails").select("*").eq("id", emailId).maybeSingle();
  if (eErr || !em) return NextResponse.json({ error: "Email not found" }, { status: 404 });
  const row = em as Record<string, unknown>;
  const rowTenantId = row.tenant_id == null || row.tenant_id === "" ? null : String(row.tenant_id);
  if (!canAccessMarketingRowByTenantId(rowTenantId, { tenantIds, isSuperAdmin })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (String(row.status) === "sent") return NextResponse.json({ error: "Already sent" }, { status: 400 });

  const { data: recs, error: rErr } = await supabase
    .from("marketing_email_recipients")
    .select("id, email_address, tracking_token, contact_id")
    .eq("email_id", emailId)
    .eq("status", "pending");
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  const recipients = (recs ?? []) as {
    id: string;
    email_address: string;
    tracking_token: string;
    contact_id: string | null;
  }[];
  if (!recipients.length) return NextResponse.json({ error: "No pending recipients — build list first" }, { status: 400 });

  const brand = await resolveBrandByTenantId(rowTenantId ?? undefined);
  const defaultFrom = brandEmailFrom(brand, process.env.RESEND_FROM_EMAIL?.trim() || "Marketing <onboarding@resend.dev>");
  const fromName = String(row.from_name ?? "").trim();
  const fromEmail = String(row.from_email ?? "").trim();
  const from =
    fromName && fromEmail ? `${fromName} <${fromEmail}>` : fromEmail ? fromEmail : defaultFrom;
  const subject = String(row.subject ?? "Message");
  const baseHtml = String(row.body_html ?? "<p></p>");
  const base = appBaseUrl();

  let sent = 0;
  const errors: string[] = [];

  for (const rec of recipients) {
    const unsub = `${base}/api/marketing/unsubscribe?t=${encodeURIComponent(rec.tracking_token)}`;
    const pixel = `${base}/api/marketing/track/open?t=${encodeURIComponent(rec.tracking_token)}`;
    const bodyTracked = wrapEmailLinksForTracking(baseHtml, base, rec.tracking_token);
    const html = `${bodyTracked}<p style="font-size:12px;color:#666"><a href="${unsub}">Unsubscribe</a></p><img src="${pixel}" width="1" height="1" alt="" />`;

    const { error: sErr } = await resend.emails.send({
      from,
      to: rec.email_address,
      subject,
      replyTo: String(row.reply_to ?? "").trim() || undefined,
      html,
    });

    if (sErr) {
      errors.push(`${rec.email_address}: ${sErr.message}`);
      continue;
    }

    await supabase
      .from("marketing_email_recipients")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", rec.id);
    sent += 1;
  }

  await supabase
    .from("marketing_emails")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      recipient_count: recipients.length,
    })
    .eq("id", emailId);

  return NextResponse.json({ ok: true, sent, failed: recipients.length - sent, errors });
}
