import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeMemberships } from "@/lib/reports/report-access";
import { eachMonthKeyInclusive } from "@/lib/reports/rent-roll-builder";

function parseDate(s: string | null): string | null {
  const t = (s ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

/** GET: list fees for reporting / admin. Non–super-admins only see amounts (no calculation_notes). */
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
  const tenantId = (url.searchParams.get("tenantId") ?? "").trim();
  const startDate = parseDate(url.searchParams.get("startDate"));
  const endDate = parseDate(url.searchParams.get("endDate"));

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  if (!isSuperAdmin && !scopedTenantIds.includes(tenantId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let q = supabase
    .from("platform_management_fees")
    .select("id, tenant_id, property_id, year, month, amount_eur, calculation_notes, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .order("year", { ascending: true })
    .order("month", { ascending: true });

  if (startDate && endDate) {
    const keys = eachMonthKeyInclusive(startDate, endDate);
    if (keys.length === 0) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }
    const yMin = Math.min(...keys.map((k) => Number(k.slice(0, 4))));
    const yMax = Math.max(...keys.map((k) => Number(k.slice(0, 4))));
    q = q.gte("year", yMin).lte("year", yMax);
  }

  const { data, error } = await q;
  if (error) {
    if (error.code === "42P01" || String(error.message).includes("platform_management_fees")) {
      return NextResponse.json({ error: "Fee table not installed. Run sql/platform_management_fees.sql." }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let rows = data ?? [];
  if (startDate && endDate) {
    const keySet = new Set(eachMonthKeyInclusive(startDate, endDate));
    rows = rows.filter((r) => keySet.has(`${r.year}-${String(r.month).padStart(2, "0")}`));
  }

  if (!isSuperAdmin) {
    return NextResponse.json({
      fees: rows.map((r) => ({
        id: r.id,
        tenant_id: r.tenant_id,
        property_id: r.property_id,
        year: r.year,
        month: r.month,
        amount_eur: r.amount_eur,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
    });
  }

  return NextResponse.json({ fees: rows });
}

type PostBody = {
  tenant_id?: string;
  property_id?: string | null;
  year?: number;
  month?: number;
  amount_eur?: number;
  calculation_notes?: string | null;
};

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
  const year = Number(body.year);
  const month = Number(body.month);
  const amount_eur = Number(body.amount_eur);
  const property_id =
    body.property_id === null || body.property_id === undefined || body.property_id === ""
      ? null
      : String(body.property_id).trim();

  if (!tenant_id || !Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(amount_eur)) {
    return NextResponse.json({ error: "tenant_id, year, month, amount_eur are required" }, { status: 400 });
  }
  if (month < 1 || month > 12 || year < 2000 || year > 2100 || amount_eur < 0) {
    return NextResponse.json({ error: "Invalid year, month, or amount" }, { status: 400 });
  }

  const insert = {
    tenant_id,
    property_id,
    year: Math.floor(year),
    month: Math.floor(month),
    amount_eur,
    calculation_notes: body.calculation_notes ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from("platform_management_fees").insert(insert).select().single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A fee already exists for this tenant, property, and month." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ fee: data });
}
