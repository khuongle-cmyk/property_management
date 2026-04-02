import { NextResponse } from "next/server";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  offerAcceptedCustomerEmail,
  offerAcceptedInternalEmail,
  offerSentEmail,
} from "@/lib/email/offerTemplates";
import { logMarketingEmailSent } from "@/lib/email/log-marketing-email";
import { leadIdForOfferCompany, resolveTenantIdForOfferCompany } from "@/lib/email/resolve-offer-tenant";

const EMAIL_TYPES = ["offer_sent", "offer_accepted_customer", "offer_accepted_internal"] as const;
type EmailType = (typeof EMAIL_TYPES)[number];

type Body = {
  offerId?: string;
  emailType?: string;
  /** Required for offer_accepted_* when caller is not logged in (public acceptance page). */
  publicToken?: string;
};

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  return new Resend(key);
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function offerFromAddress(salesName: string): string {
  const safeName = salesName.replace(/[\r\n]/g, " ").trim() || "VillageWorks";
  return `[${safeName}] at VillageWorks <noreply@villageworks.com>`;
}

async function resolveSalesPerson(
  admin: SupabaseClient,
  userId: string | null,
): Promise<{ name: string; email: string; phone: string }> {
  const fallbackEmail = (process.env.SALES_INBOX_ADDRESS ?? "sales@villageworks.com").trim();
  const fallback = { name: "VillageWorks", email: fallbackEmail, phone: "" };
  if (!userId) return fallback;

  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) return fallback;

  const u = data.user;
  const email = (u.email ?? "").trim() || fallbackEmail;
  const meta = (u.user_metadata ?? {}) as Record<string, string | undefined>;
  let name = (meta.full_name ?? meta.name ?? meta.display_name ?? "").trim();
  let phone = (meta.phone ?? "").trim();
  if (!name && u.email) name = u.email.split("@")[0] ?? "VillageWorks";
  if (!name) name = "VillageWorks";

  const { data: prof } = await admin.from("users").select("full_name, phone").eq("id", userId).maybeSingle();
  const p = prof as { full_name?: string | null; phone?: string | null } | null;
  if (p?.full_name?.trim()) name = p.full_name.trim();
  if (!phone && p?.phone?.trim()) phone = p.phone.trim();

  return { name, email, phone };
}

function formatMonthlyPrice(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return `€${n.toLocaleString("en-IE")} / month`;
}

function formatStartDate(v: unknown): string {
  if (v == null || v === "") return "—";
  const s = String(v);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-GB", { dateStyle: "medium" });
  return s;
}

export async function POST(req: Request) {
  console.log("=== ROUTE FILE LOADED ===");
  try {
    console.log("=== TRY BLOCK ENTERED ===");
    console.log("=== send-email route hit ===");

    let body: Body;
    try {
      body = (await req.json()) as Body;
      console.log("Request body:", body);
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const offerId = body.offerId?.trim();
    const emailTypeRaw = body.emailType?.trim();
    const publicToken = body.publicToken?.trim();

    if (!offerId || !emailTypeRaw || !EMAIL_TYPES.includes(emailTypeRaw as EmailType)) {
      return NextResponse.json({ ok: false, error: "offerId and valid emailType are required" }, { status: 400 });
    }
    const emailType = emailTypeRaw as EmailType;

    const isPublicAccept =
      emailType === "offer_accepted_customer" || emailType === "offer_accepted_internal";

    const supabase = await createSupabaseServerClient();
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();
    console.log("User:", sessionUser?.email ?? null);

    if (!isPublicAccept && !sessionUser) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (isPublicAccept && !publicToken) {
      return NextResponse.json({ ok: false, error: "publicToken is required for this email type" }, { status: 400 });
    }

    const admin: SupabaseClient = getSupabaseAdminClient();
    console.log("Supabase admin client created");

    const { data: offer, error: oErr } = await admin.from("offers").select("*").eq("id", offerId).maybeSingle();
    console.log("Offer fetch result:", offer, oErr);
    if (oErr) throw new Error(oErr.message);
    if (!offer) return NextResponse.json({ ok: false, error: "Offer not found" }, { status: 404 });

    const row = offer as Record<string, unknown>;
    if (row.is_template === true) {
      return NextResponse.json({ ok: false, error: "Template offers cannot be emailed" }, { status: 400 });
    }

    if (isPublicAccept) {
      if (String(row.public_token ?? "") !== publicToken) {
        return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 403 });
      }
      if (String(row.status ?? "") !== "accepted") {
        return NextResponse.json({ ok: false, error: "Offer is not accepted" }, { status: 400 });
      }
    }

    let lead: { company_name: string | null; email: string | null; phone: string | null } | null = null;
    if (row.company_id) {
      const { data: company, error: companyError } = await admin
        .from("crm_contacts")
        .select("*")
        .eq("id", row.company_id as string)
        .maybeSingle();
      console.log("Company fetch result (crm_contacts):", company, companyError);

      if (company && !companyError) {
        const c = company as { company_name?: string | null; email?: string | null; phone?: string | null };
        lead = { company_name: c.company_name ?? null, email: c.email ?? null, phone: c.phone ?? null };
      } else {
        const { data: l, error: lErr } = await admin
          .from("leads")
          .select("company_name, email, phone")
          .eq("id", row.company_id as string)
          .maybeSingle();
        console.log("Company fetch result (leads fallback):", l, lErr);
        if (lErr) throw new Error(lErr.message);
        lead = l;
      }
    }

    const companyName = String(lead?.company_name ?? row.customer_company ?? "");
    const customerName = String(row.customer_name ?? "");
    const offerTitle = String(row.title ?? "Offer");
    const createdById = typeof row.created_by === "string" ? row.created_by : null;

    const salesUserId =
      emailType === "offer_sent" ? createdById ?? sessionUser?.id ?? null : createdById;

    const sales = await resolveSalesPerson(admin, salesUserId);
    const from = offerFromAddress(sales.name);
    const replyTo = isValidEmail(sales.email) ? sales.email : undefined;
    console.log("From/replyTo:", { from, replyTo });

    const resend = getResend();
    console.log("RESEND_API_KEY exists:", !!process.env.RESEND_API_KEY);
    if (!resend) {
      return NextResponse.json({ ok: false, error: "Email is not configured (RESEND_API_KEY missing)" }, { status: 503 });
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      new URL(req.url).origin;
    const base = appUrl.replace(/\/$/, "");
    const publicTok = String(row.public_token ?? "");
    const offerLink = publicTok ? `${base}/offers/${encodeURIComponent(publicTok)}` : base;

    const spaceDetails = String(row.space_details ?? "—");
    const contractMonths =
      row.contract_length_months != null && row.contract_length_months !== ""
        ? `${row.contract_length_months} months`
        : "—";

    if (emailType === "offer_sent") {
      const toRaw = (lead?.email ?? row.customer_email ?? "") as string;
      const to = toRaw.trim().toLowerCase();
      if (!to || !isValidEmail(to)) {
        return NextResponse.json({ ok: false, error: "No valid recipient email for this offer" }, { status: 400 });
      }

      const tpl = offerSentEmail({
        customerName,
        companyName,
        offerTitle,
        spaceDetails,
        monthlyPrice: formatMonthlyPrice(row.monthly_price),
        contractLengthMonths: contractMonths,
        startDate: formatStartDate(row.start_date),
        offerLink,
        salesName: sales.name,
        salesEmail: sales.email,
        salesPhone: sales.phone,
      });

      const { error: sErr } = await resend.emails.send({
        from,
        to,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        ...(replyTo ? { replyTo } : {}),
      });
      console.log("Resend result (offer_sent):", sErr ?? "ok");
      if (sErr) throw new Error(sErr.message);

      const { error: uErr } = await admin
        .from("offers")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", offerId);
      if (uErr) throw new Error(uErr.message);

      return NextResponse.json({ ok: true });
    }

    if (emailType === "offer_accepted_customer") {
      const toRaw = (row.customer_email ?? lead?.email ?? "") as string;
      const to = toRaw.trim().toLowerCase();
      if (!to || !isValidEmail(to)) {
        return NextResponse.json({ ok: false, error: "No valid customer email" }, { status: 400 });
      }

      const tpl = offerAcceptedCustomerEmail({
        customerName,
        companyName,
        salesName: sales.name,
        salesEmail: sales.email,
        salesPhone: sales.phone,
      });

      const { error: sErr } = await resend.emails.send({
        from,
        to,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        ...(replyTo ? { replyTo } : {}),
      });
      console.log("Resend result (offer_accepted_customer):", sErr ?? "ok");
      if (sErr) throw new Error(sErr.message);

      const tenantIdLog = await resolveTenantIdForOfferCompany(admin, row.company_id as string | null);
      const leadContactId = await leadIdForOfferCompany(admin, row.company_id as string | null);
      void logMarketingEmailSent(admin, {
        tenant_id: tenantIdLog,
        subject: tpl.subject,
        body_html: tpl.html,
        from_name: `${sales.name} at VillageWorks`,
        from_email: "noreply@villageworks.com",
        reply_to: sales.email,
        source: "contracts",
        related_id: offerId,
        related_type: "offer",
        recipient_email: to,
        contact_id: leadContactId,
      });

      return NextResponse.json({ ok: true });
    }

    // offer_accepted_internal
    const internalTo = sales.email.trim();
    if (!isValidEmail(internalTo)) {
      return NextResponse.json({ ok: false, error: "No valid internal recipient" }, { status: 400 });
    }

    const acceptedRaw = row.accepted_at ?? new Date().toISOString();
    const acceptedAt =
      typeof acceptedRaw === "string"
        ? new Date(acceptedRaw).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
        : String(acceptedRaw);

    const tpl = offerAcceptedInternalEmail({
      companyName: companyName || "—",
      offerTitle,
      acceptedAt,
      salesName: sales.name,
    });

    const { error: sErr } = await resend.emails.send({
      from,
      to: internalTo,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      ...(replyTo ? { replyTo } : {}),
    });
    console.log("Resend result (offer_accepted_internal):", sErr ?? "ok");
    if (sErr) throw new Error(sErr.message);

    const tenantIdLog = await resolveTenantIdForOfferCompany(admin, row.company_id as string | null);
    void logMarketingEmailSent(admin, {
      tenant_id: tenantIdLog,
      subject: tpl.subject,
      body_html: tpl.html,
      from_name: `${sales.name} at VillageWorks`,
      from_email: "noreply@villageworks.com",
      reply_to: sales.email,
      source: "contracts",
      related_id: offerId,
      related_type: "offer",
      recipient_email: internalTo,
      contact_id: null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("=== SEND EMAIL CRASH ===", error);
    console.error("Send email error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
