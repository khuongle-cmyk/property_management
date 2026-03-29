import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeMemberships } from "@/lib/reports/report-access";

function canAccessTenant(
  isSuperAdmin: boolean,
  scopedTenantIds: string[],
  tenantId: string,
): boolean {
  if (isSuperAdmin) return true;
  return scopedTenantIds.includes(tenantId);
}

/** GET /api/admin-fees?tenant_id=X — tenant members + super admin (read-only for owners). */
export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membershipRows, error: mErr } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const { isSuperAdmin, scopedTenantIds } = normalizeMemberships(
    (membershipRows ?? []) as { tenant_id: string | null; role: string | null }[],
  );

  const url = new URL(req.url);
  const tenantId = (url.searchParams.get("tenant_id") ?? "").trim();
  if (!tenantId) {
    return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
  }

  if (!canAccessTenant(isSuperAdmin, scopedTenantIds, tenantId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  /** Payer org may be `tenant_id` (canonical) or `recipient_tenant_id` (platform-billed row). */
  const { data, error } = await supabase
    .from("administration_cost_settings")
    .select("*")
    .or(`tenant_id.eq.${tenantId},recipient_tenant_id.eq.${tenantId}`)
    .order("created_at", { ascending: true });

  if (error) {
    if (error.code === "42P01" || String(error.message).includes("administration_cost_settings")) {
      return NextResponse.json(
        { error: "administration_cost_settings table not found." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ settings: data ?? [] });
}

type PostBody = {
  tenant_id?: string;
  property_id?: string | null;
  /** Display label (same as legacy `name`) */
  fee_name?: string | null;
  name?: string | null;
  /** Category slug: management_fee, …, other */
  fee_category?: string | null;
  /** Calculation mode: fixed_amount, percentage_of_revenue, … */
  calculation_mode?: string | null;
  fee_type?: string | null;
  custom_name?: string | null;
  fixed_amount?: number | null;
  fixed_period?: string | null;
  percentage_value?: number | null;
  percentage_basis?: string | null;
  minimum_fee?: number | null;
  maximum_fee?: number | null;
  is_active?: boolean | null;
  recipient_tenant_id?: string | null;
};

/** POST /api/admin-fees — super_admin only */
export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: mRows, error: mErr } = await supabase.from("memberships").select("role").eq("user_id", user.id);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  const isSuperAdmin = (mRows ?? []).some((m) => String(m.role ?? "").toLowerCase() === "super_admin");
  if (!isSuperAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tenant_id = (body.tenant_id ?? "").trim();
  if (!tenant_id) {
    return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
  }

  const property_id =
    body.property_id === null || body.property_id === undefined || body.property_id === ""
      ? null
      : String(body.property_id).trim();

  const displayName = (body.fee_name ?? body.name ?? "").trim() || null;
  const feeCategory = (body.fee_category ?? body.custom_name ?? "").trim() || "management_fee";
  const rawMode = (body.calculation_mode ?? "").trim().toLowerCase();
  const calculationMode =
    rawMode === "fixed" || rawMode === "percentage" || rawMode === "combination" ? rawMode : "fixed";

  const recipientRaw = body.recipient_tenant_id;
  const recipient_tenant_id =
    recipientRaw === null || recipientRaw === undefined || recipientRaw === ""
      ? null
      : String(recipientRaw).trim();

  const insert: Record<string, unknown> = {
    tenant_id,
    property_id,
    name: displayName,
    fee_type: feeCategory,
    custom_name: feeCategory,
    calculation_mode: calculationMode,
    fixed_amount: body.fixed_amount ?? null,
    fixed_period: body.fixed_period ?? "monthly",
    percentage_value: body.percentage_value ?? null,
    percentage_basis: body.percentage_basis ?? null,
    minimum_fee: body.minimum_fee ?? null,
    maximum_fee: body.maximum_fee ?? null,
    is_active: body.is_active !== false,
    recipient_tenant_id,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from("administration_cost_settings").insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ setting: data });
}
