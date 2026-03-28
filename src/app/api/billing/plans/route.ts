import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMembershipScope } from "@/lib/billing/access";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const scope = await getMembershipScope(supabase);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabase.from("pricing_plans").select("*").order("display_name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, plans: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const scope = await getMembershipScope(supabase);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!scope.isSuperAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json()) as Record<string, unknown>;
  const id = String(body.id ?? "").toLowerCase();
  if (!["starter", "professional", "enterprise"].includes(id)) {
    return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  }
  const payload = {
    id,
    display_name: String(body.display_name ?? id),
    monthly_base_fee: Number(body.monthly_base_fee ?? 0),
    included_properties: Number(body.included_properties ?? 0),
    per_property_fee: Number(body.per_property_fee ?? 0),
    included_users: Number(body.included_users ?? 0),
    per_user_fee: Number(body.per_user_fee ?? 0),
    trial_days: Number(body.trial_days ?? 14),
    is_active: body.is_active !== false,
    notes: body.notes ? String(body.notes) : null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("pricing_plans").upsert(payload, { onConflict: "id" }).select("*").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, plan: data });
}

