/*
 * Run in Supabase SQL editor before testing offer acceptance → contract draft:
 *
 * ALTER TABLE contracts ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES offers(id);
 *
 * If the contract insert fails, also run:
 * ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
 * ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS contract_body text;
 * ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
 */

import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ token: string }> };

const DEFAULT_CONTRACT_BODY = `RENTAL AGREEMENT (DRAFT)

This rental agreement is between VillageWorks and the customer named in the schedule below.

The parties agree to the commercial terms, space description, rent, and term length as set out in the offer accepted by the customer.

General conditions:
1. This draft becomes binding when executed according to the agreed signing process.
2. Rent is stated exclusive of VAT unless otherwise specified.
3. A security deposit and notice period apply as described in the final contract terms.

---
This text is a starting point only — review and replace with your approved legal wording before sending for signing.
`;

type OfferRow = Record<string, unknown> & {
  id: string;
  status?: string | null;
  title?: string | null;
  company_id?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  customer_company?: string | null;
  property_id?: string | null;
  space_details?: string | null;
  monthly_price?: unknown;
  contract_length_months?: unknown;
  start_date?: string | null;
  intro_text?: string | null;
  terms_text?: string | null;
};

/** Public: load offer by share token (no auth). */
export async function GET(_req: Request, context: Ctx) {
  try {
    const { token: raw } = await context.params;
    const token = decodeURIComponent(raw ?? "").trim();
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const { data: offer, error } = await admin
      .from("offers")
      .select(
        "id,title,status,public_token,customer_name,customer_company,company_id,property_id,space_details,monthly_price,contract_length_months,start_date,intro_text,terms_text,is_template,accepted_at,customer_email,customer_phone",
      )
      .eq("public_token", token)
      .eq("is_template", false)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

    let companyName: string | null = null;
    if (offer.company_id) {
      const { data: lead } = await admin.from("leads").select("company_name").eq("id", offer.company_id).maybeSingle();
      companyName = lead?.company_name ?? null;
    }

    let property: { name: string | null; address: string | null; city: string | null } | null = null;
    if (offer.property_id) {
      const { data: p } = await admin.from("properties").select("name,address,city").eq("id", offer.property_id).maybeSingle();
      property = p ?? null;
    }

    return NextResponse.json({ offer, property, companyName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    if (msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Public: accept offer by share token (no auth). Creates a contract draft when newly accepted. */
export async function POST(_req: Request, context: Ctx) {
  try {
    const { token: raw } = await context.params;
    const token = decodeURIComponent(raw ?? "").trim();
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const { data: offer, error: qErr } = await admin
      .from("offers")
      .select("*")
      .eq("public_token", token)
      .eq("is_template", false)
      .maybeSingle();

    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
    if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

    const row = offer as OfferRow;

    if (row.status === "accepted" || row.accepted_at) {
      return NextResponse.json({ ok: true, alreadyAccepted: true });
    }

    if (row.status !== "draft" && row.status !== "sent") {
      return NextResponse.json({ error: "This offer cannot be accepted" }, { status: 400 });
    }

    const previousStatus = String(row.status ?? "draft");
    const previousAcceptedAt = row.accepted_at ?? null;

    const { error: uErr } = await admin
      .from("offers")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

    let tenantId: string | null = typeof row.tenant_id === "string" ? row.tenant_id : null;
    if (!tenantId && row.company_id) {
      const { data: lead } = await admin.from("leads").select("tenant_id").eq("id", row.company_id).maybeSingle();
      const tid = (lead as { tenant_id?: string } | null)?.tenant_id;
      tenantId = typeof tid === "string" ? tid : null;
    }

    const offerTitle = row.title ?? "Offer";
    const contractTitle = `Rental Agreement — ${offerTitle}`;

    const createdBy = typeof row.created_by === "string" ? row.created_by : null;

    const insertPayload: Record<string, unknown> = {
      tenant_id: tenantId,
      offer_id: row.id,
      source_offer_id: row.id,
      company_id: row.company_id ?? null,
      lead_id: row.company_id ?? null,
      customer_name: row.customer_name ?? null,
      customer_email: row.customer_email ?? null,
      customer_phone: row.customer_phone ?? null,
      customer_company: row.customer_company ?? null,
      property_id: row.property_id ?? null,
      space_details: row.space_details ?? null,
      monthly_price: row.monthly_price ?? null,
      contract_length_months: row.contract_length_months ?? null,
      start_date: row.start_date ?? null,
      title: contractTitle,
      contract_body: DEFAULT_CONTRACT_BODY,
      intro_text: row.intro_text ?? null,
      terms_text: row.terms_text ?? null,
      status: "draft",
      version: 1,
      signing_method: "esign",
      is_template: false,
      created_by: createdBy,
    };

    const { error: insErr } = await admin.from("contracts").insert(insertPayload);
    if (insErr) {
      await admin
        .from("offers")
        .update({ status: previousStatus, accepted_at: previousAcceptedAt })
        .eq("id", row.id);
      return NextResponse.json(
        { ok: false, error: insErr.message, hint: "Run the SQL in the comment at the top of this file if columns are missing (offer_id, tenant_id, contract_body, created_by)." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    if (msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
