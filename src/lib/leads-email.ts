import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LeadEmailPayload = {
  companyName: string;
  contactName: string;
  email: string;
  phone?: string | null;
  source: string;
  interestedSpaceType?: string | null;
  approxSizeM2?: number | null;
  approxBudgetEurMonth?: number | null;
  message?: string | null;
};

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function emailFromUsersJoin(users: { email: string } | { email: string }[] | null | undefined): string | null {
  if (!users) return null;
  const row = Array.isArray(users) ? users[0] : users;
  const em = row?.email?.trim();
  return em || null;
}

async function getOwnerManagerEmails(client: SupabaseClient, tenantId: string): Promise<string[]> {
  const { data: rows } = await client
    .from("memberships")
    .select("role, users ( email )")
    .eq("tenant_id", tenantId);

  const emails = new Set<string>();
  for (const row of (rows ?? []) as unknown as { role: string | null; users: { email: string } | { email: string }[] | null }[]) {
    const role = (row.role ?? "").toLowerCase();
    if (role !== "owner" && role !== "manager") continue;
    const em = emailFromUsersJoin(row.users);
    if (em) emails.add(em);
  }
  return [...emails];
}

export async function sendLeadCreatedEmails(
  client: SupabaseClient,
  tenantId: string,
  payload: LeadEmailPayload
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const resend = getResend();
  if (!resend) return { ok: true, skipped: "RESEND_API_KEY not set" };

  const from = process.env.RESEND_FROM_EMAIL?.trim() || "Leads <onboarding@resend.dev>";

  const staffTargets = await getOwnerManagerEmails(client, tenantId);
  const subjectManager = `New lead (${payload.source}) — ${payload.companyName}`;
  const managerHtml = [
    `<p>A new lead was created.</p>`,
    `<p><strong>Company:</strong> ${payload.companyName}</p>`,
    `<p><strong>Contact:</strong> ${payload.contactName} (${payload.email})</p>`,
    payload.phone ? `<p><strong>Phone:</strong> ${payload.phone}</p>` : "",
    payload.interestedSpaceType ? `<p><strong>Interested space:</strong> ${payload.interestedSpaceType}</p>` : "",
    payload.approxSizeM2 != null ? `<p><strong>Approx size:</strong> ${payload.approxSizeM2} m2</p>` : "",
    payload.approxBudgetEurMonth != null ? `<p><strong>Approx budget:</strong> €${payload.approxBudgetEurMonth}/month</p>` : "",
    payload.message ? `<p><strong>Message:</strong> ${payload.message}</p>` : "",
  ]
    .filter(Boolean)
    .join("");

  for (const to of staffTargets) {
    const { error } = await resend.emails.send({ from, to, subject: subjectManager, html: managerHtml });
    if (error) return { ok: false, error: error.message };
  }

  const subjectLead = `Thanks for contacting us — ${payload.companyName}`;
  const leadHtml = [
    `<p>Hi ${payload.contactName},</p>`,
    `<p>Thanks for your inquiry. Our team received your request and will contact you soon.</p>`,
    `<p><strong>Summary</strong></p>`,
    `<p>Company: ${payload.companyName}</p>`,
    payload.interestedSpaceType ? `<p>Interested space: ${payload.interestedSpaceType}</p>` : "",
    payload.approxSizeM2 != null ? `<p>Approx size: ${payload.approxSizeM2} m2</p>` : "",
    payload.approxBudgetEurMonth != null ? `<p>Approx budget: €${payload.approxBudgetEurMonth}/month</p>` : "",
  ]
    .filter(Boolean)
    .join("");
  const { error: leadErr } = await resend.emails.send({
    from,
    to: payload.email,
    subject: subjectLead,
    html: leadHtml,
  });
  if (leadErr) return { ok: false, error: leadErr.message };

  return { ok: true };
}

