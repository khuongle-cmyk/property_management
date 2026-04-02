import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = (url.searchParams.get("t") ?? "").trim();

  if (!token) {
    return new NextResponse("<html><body><p>Invalid link.</p></body></html>", {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  let supabase;
  try {
    supabase = getSupabaseAdminClient();
  } catch {
    return new NextResponse("<html><body><p>Service unavailable.</p></body></html>", {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const { data: rec } = await supabase
    .from("marketing_email_recipients")
    .select("id, contact_id, email_address, email_id")
    .eq("tracking_token", token)
    .maybeSingle();

  if (!rec) {
    return new NextResponse("<html><body><p>This unsubscribe link is no longer valid.</p></body></html>", {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const r = rec as { id: string; contact_id: string | null; email_address: string; email_id: string };
  await supabase
    .from("marketing_email_recipients")
    .update({ status: "unsubscribed" })
    .eq("id", r.id);

  const { data: emRow } = await supabase.from("marketing_emails").select("tenant_id").eq("id", r.email_id).maybeSingle();
  const tenantId = (emRow as { tenant_id: string } | null)?.tenant_id;

  if (r.contact_id) {
    await supabase.from("leads").update({ email_unsubscribed: true }).eq("id", r.contact_id);
  } else if (tenantId) {
    await supabase
      .from("leads")
      .update({ email_unsubscribed: true })
      .eq("tenant_id", tenantId)
      .ilike("email", r.email_address);
  } else {
    await supabase
      .from("leads")
      .update({ email_unsubscribed: true })
      .ilike("email", r.email_address);
  }

  const emailId = r.email_id;
  if (emailId) {
    const { data: row } = await supabase.from("marketing_emails").select("unsubscribe_count").eq("id", emailId).maybeSingle();
    const uc = Number((row as { unsubscribe_count: number } | null)?.unsubscribe_count ?? 0);
    await supabase.from("marketing_emails").update({ unsubscribe_count: uc + 1 }).eq("id", emailId);
  }

  return new NextResponse(
    "<html><body><p>You have been unsubscribed from marketing emails.</p></body></html>",
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
