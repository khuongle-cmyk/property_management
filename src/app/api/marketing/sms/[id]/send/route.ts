import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessMarketingRowByTenantId, getMarketingAccess } from "@/lib/marketing/access";

type Ctx = { params: Promise<{ id: string }> };

const OPT_OUT = " Reply STOP to unsubscribe.";

export async function POST(_req: Request, ctx: Ctx) {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromDefault = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!sid || !token || !fromDefault) {
    return NextResponse.json({ error: "Twilio env not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)" }, { status: 503 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getMarketingAccess(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: smsId } = await ctx.params;
  if (!smsId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: smsRow, error: sErr } = await supabase.from("marketing_sms").select("*").eq("id", smsId).maybeSingle();
  if (sErr || !smsRow) return NextResponse.json({ error: "SMS not found" }, { status: 404 });
  const row = smsRow as Record<string, unknown>;
  const tenantId = row.tenant_id as string | null;
  if (!canAccessMarketingRowByTenantId(tenantId, { tenantIds, isSuperAdmin })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (String(row.status) === "sent") return NextResponse.json({ error: "Already sent" }, { status: 400 });

  let body = String(row.message_text ?? "");
  if (!body.toUpperCase().includes("STOP")) body = body + OPT_OUT;

  const fromNum = String(row.from_number ?? "").trim() || fromDefault;

  const { data: recs, error: rErr } = await supabase
    .from("marketing_sms_recipients")
    .select("id, phone_number")
    .eq("sms_id", smsId)
    .eq("status", "pending");
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  const recipients = (recs ?? []) as { id: string; phone_number: string }[];
  if (!recipients.length) return NextResponse.json({ error: "No pending recipients" }, { status: 400 });

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;

  let delivered = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const rec of recipients) {
    const params = new URLSearchParams({ To: rec.phone_number, From: fromNum, Body: body });
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = (await resp.json()) as { sid?: string; message?: string; error_message?: string };
    if (!resp.ok) {
      failed += 1;
      errors.push(`${rec.phone_number}: ${json.message ?? json.error_message ?? resp.statusText}`);
      await supabase.from("marketing_sms_recipients").update({ status: "failed" }).eq("id", rec.id);
      continue;
    }
    delivered += 1;
    await supabase
      .from("marketing_sms_recipients")
      .update({ status: "delivered", sent_at: new Date().toISOString(), delivered_at: new Date().toISOString() })
      .eq("id", rec.id);
  }

  await supabase
    .from("marketing_sms")
    .update({
      status: failed === recipients.length ? "failed" : "sent",
      sent_at: new Date().toISOString(),
      recipient_count: recipients.length,
      delivered_count: delivered,
      failed_count: failed,
    })
    .eq("id", smsId);

  return NextResponse.json({ ok: true, delivered, failed, errors });
}
