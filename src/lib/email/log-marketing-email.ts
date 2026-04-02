import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LogMarketingEmailInput = {
  tenant_id: string | null;
  subject: string;
  body_html: string;
  preview_text?: string | null;
  from_name?: string | null;
  from_email?: string | null;
  reply_to?: string | null;
  source: string;
  related_id: string | null;
  related_type: string | null;
  recipient_email: string;
  contact_id?: string | null;
  /** When omitted, a new token is generated for the recipient row. */
  tracking_token?: string;
};

/** Inserts a sent row into marketing_emails + marketing_email_recipients (admin client, bypasses RLS). */
export async function logMarketingEmailSent(admin: SupabaseClient, row: LogMarketingEmailInput): Promise<void> {
  const now = new Date().toISOString();
  const { data: em, error: e1 } = await admin
    .from("marketing_emails")
    .insert({
      tenant_id: row.tenant_id,
      subject: row.subject,
      body_html: row.body_html,
      preview_text: row.preview_text ?? null,
      from_name: row.from_name ?? null,
      from_email: row.from_email ?? null,
      reply_to: row.reply_to ?? null,
      status: "sent",
      sent_at: now,
      recipient_count: 1,
      source: row.source,
      related_id: row.related_id,
      related_type: row.related_type,
    })
    .select("id")
    .single();
  if (e1 || !em) {
    console.error("logMarketingEmailSent insert marketing_emails:", e1);
    return;
  }
  const emailId = (em as { id: string }).id;
  const { error: e2 } = await admin.from("marketing_email_recipients").insert({
    email_id: emailId,
    email_address: row.recipient_email.trim().toLowerCase(),
    contact_id: row.contact_id ?? null,
    status: "sent",
    sent_at: now,
    tracking_token: row.tracking_token ?? randomUUID(),
  });
  if (e2) console.error("logMarketingEmailSent insert recipient:", e2);
}
