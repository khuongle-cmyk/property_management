import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeMemberships } from "@/lib/reports/report-access";
import { eachMonthKeyInclusive } from "@/lib/reports/rent-roll-builder";
import { loadRentRollSourceRows } from "@/lib/reports/rent-roll-data";
import { buildNetIncomeReport } from "@/lib/reports/net-income-builder";

/**
 * Returns revenue/cost basis for the most recent month with data (for fee preview in the UI).
 */
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

  if (!isSuperAdmin && !scopedTenantIds.includes(tenantId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: props, error: pErr } = await supabase
    .from("properties")
    .select("id")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  const ids = ((props ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length === 0) {
    return NextResponse.json({
      monthKey: null,
      revenueTotal: 0,
      officeRent: 0,
      totalCosts: 0,
      note: "No properties for tenant",
    });
  }

  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  const monthKeys = eachMonthKeyInclusive(startStr, endStr);
  if (monthKeys.length === 0) {
    return NextResponse.json({ monthKey: null, revenueTotal: 0, officeRent: 0, totalCosts: 0 });
  }

  const { source, error: loadErr } = await loadRentRollSourceRows(supabase, ids, monthKeys);
  if (loadErr || !source) {
    return NextResponse.json({ error: loadErr ?? "Load failed" }, { status: 500 });
  }

  const report = buildNetIncomeReport(monthKeys, source, [], {});
  let best: { monthKey: string; rev: number; office: number; costs: number } | null = null;
  for (const pm of report.portfolioByMonth) {
    const activity = pm.revenue.total + pm.costs.total;
    if (!best || activity > best.rev + best.costs) {
      best = {
        monthKey: pm.monthKey,
        rev: pm.revenue.total,
        office: pm.revenue.office,
        costs: pm.costs.total,
      };
    }
  }

  if (!best || best.rev + best.costs === 0) {
    const last = report.portfolioByMonth[report.portfolioByMonth.length - 1];
    return NextResponse.json({
      monthKey: last?.monthKey ?? monthKeys[monthKeys.length - 1] ?? null,
      revenueTotal: last?.revenue.total ?? 0,
      officeRent: last?.revenue.office ?? 0,
      totalCosts: last?.costs.total ?? 0,
      note: "Using last month in range (little activity)",
    });
  }

  return NextResponse.json({
    monthKey: best.monthKey,
    revenueTotal: best.rev,
    officeRent: best.office,
    totalCosts: best.costs,
  });
}
