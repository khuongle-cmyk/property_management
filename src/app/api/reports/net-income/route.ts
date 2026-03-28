import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { eachMonthKeyInclusive } from "@/lib/reports/rent-roll-builder";
import { buildNetIncomeReport } from "@/lib/reports/net-income-builder";
import type { PropertyCostEntryRow } from "@/lib/reports/net-income-types";
import { loadHistoricalAdminCostsAsEntries, loadHistoricalCostsAsEntries } from "@/lib/reports/historical-costs";
import { loadRentRollSourceRows } from "@/lib/reports/rent-roll-data";
import { normalizeMemberships, resolveAllowedPropertyIds } from "@/lib/reports/report-access";
import { attachPlatformManagementFees } from "@/lib/reports/platform-management-fees-report";

type Body = {
  propertyIds?: string[] | null;
  startDate?: string;
  endDate?: string;
  includeAdministration?: boolean;
  allocateAdminByRevenue?: boolean;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const startDate = (body.startDate ?? "").trim().slice(0, 10);
  const endDate = (body.endDate ?? "").trim().slice(0, 10);
  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate are required (YYYY-MM-DD)" }, { status: 400 });
  }

  const monthKeys = eachMonthKeyInclusive(startDate, endDate);
  if (monthKeys.length === 0) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }
  if (monthKeys.length > 120) {
    return NextResponse.json({ error: "Range too large (max 120 months)" }, { status: 400 });
  }

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

  const { isSuperAdmin, canRunReports, scopedTenantIds } = normalizeMemberships(
    (membershipRows ?? []) as { tenant_id: string | null; role: string | null }[],
  );
  if (!canRunReports) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requestedIds =
    Array.isArray(body.propertyIds) && body.propertyIds.length > 0 ? body.propertyIds : null;

  const { allowedIds, error: scopeErr } = await resolveAllowedPropertyIds(
    supabase,
    isSuperAdmin,
    scopedTenantIds,
    requestedIds,
  );
  if (scopeErr || allowedIds.length === 0) {
    return NextResponse.json({ error: scopeErr ?? "No properties" }, { status: 400 });
  }

  const { source, error: loadErr } = await loadRentRollSourceRows(supabase, allowedIds, monthKeys);
  if (loadErr || !source) {
    return NextResponse.json({ error: loadErr ?? "Failed to load revenue data" }, { status: 500 });
  }

  let tenantId: string | null = null;
  if (allowedIds[0]) {
    const { data: p0 } = await supabase.from("properties").select("tenant_id").eq("id", allowedIds[0]).maybeSingle();
    tenantId = (p0 as { tenant_id: string } | null)?.tenant_id ?? null;
  }

  const firstMonthDay = `${monthKeys[0]}-01`;
  const lastMk = monthKeys[monthKeys.length - 1];
  const lastMonthDay = `${lastMk}-01`;

  const { data: costRows, error: cErr } = await supabase
    .from("property_cost_entries")
    .select(
      "id, property_id, cost_type, description, amount, cost_date, period_month, supplier_name, invoice_number, notes, status, source, recurring_template_id",
    )
    .in("property_id", allowedIds)
    .gte("period_month", firstMonthDay)
    .lte("period_month", lastMonthDay);

  if (cErr) {
    if (cErr.message.includes("property_cost_entries") || cErr.code === "42P01") {
      return NextResponse.json(
        {
          error:
            "Cost tables not found. Run sql/property_costs_net_income.sql in the Supabase SQL editor.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  const entries = (costRows ?? []) as PropertyCostEntryRow[];
  const { rows: historicalEntries, error: hErr } = await loadHistoricalCostsAsEntries(
    supabase,
    allowedIds,
    firstMonthDay,
    lastMonthDay,
  );
  if (hErr) return NextResponse.json({ error: hErr }, { status: 500 });

  let adminEntries: Awaited<ReturnType<typeof loadHistoricalAdminCostsAsEntries>>["rows"] = [];
  if (body.includeAdministration && tenantId) {
    const { rows: a, error: aErr } = await loadHistoricalAdminCostsAsEntries(
      supabase,
      tenantId,
      firstMonthDay,
      lastMonthDay,
    );
    if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
    adminEntries = a;
  }

  let report = buildNetIncomeReport(monthKeys, source, [...entries, ...historicalEntries], {
    includeAdministrationInTrueNet: !!body.includeAdministration,
    allocateAdminByRevenueShare: !!body.allocateAdminByRevenue,
    administrationEntries: adminEntries,
  });
  report = await attachPlatformManagementFees(supabase, report, allowedIds);
  return NextResponse.json(report);
}
