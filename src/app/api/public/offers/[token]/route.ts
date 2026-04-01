import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type RouteContext = { params: Promise<{ token: string }> };

/** Public: load offer by share token (no auth). */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const t = decodeURIComponent(token ?? "").trim();
    if (!t) return NextResponse.json({ error: "Missing token" }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const { data: offer, error } = await admin
      .from("offers")
      .select(
        "id,title,status,public_token,customer_name,customer_company,property_id,space_details,monthly_price,contract_length_months,start_date,intro_text,terms_text,is_template,accepted_at",
      )
      .eq("public_token", t)
      .eq("is_template", false)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

    let property: { name: string | null; address: string | null; city: string | null } | null = null;
    if (offer.property_id) {
      const { data: p } = await admin.from("properties").select("name,address,city").eq("id", offer.property_id).maybeSingle();
      property = p ?? null;
    }

    return NextResponse.json({ offer, property });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    if (msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Public: accept offer by share token. */
export async function POST(_req: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const t = decodeURIComponent(token ?? "").trim();
    if (!t) return NextResponse.json({ error: "Missing token" }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const { data: row, error: qErr } = await admin
      .from("offers")
      .select("id,status,accepted_at,is_template")
      .eq("public_token", t)
      .eq("is_template", false)
      .maybeSingle();

    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
    if (!row) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    if (row.status === "accepted" || row.accepted_at) {
      return NextResponse.json({ ok: true, alreadyAccepted: true });
    }

    const { error: uErr } = await admin
      .from("offers")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    if (msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
