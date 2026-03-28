import type { SupabaseClient } from "@supabase/supabase-js";
import type { NetIncomeMonthRow, NetIncomeReportModel } from "./net-income-types";

export type PlatformManagementFeeRow = {
  id: string;
  tenant_id: string;
  property_id: string | null;
  year: number;
  month: number;
  amount_eur: number;
  calculation_notes?: string | null;
};

function monthKeyFromParts(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Applies platform fees to per-property rows (direct + portfolio-wide allocated by revenue share
 * within the tenant among properties present in this report for that month).
 */
export function mergePlatformManagementFeesIntoReport(
  report: NetIncomeReportModel,
  fees: PlatformManagementFeeRow[],
  propertyTenantMap: Map<string, string>,
): NetIncomeReportModel {
  const monthSet = new Set(report.monthKeys);
  const direct = new Map<string, number>();
  const portfolioByTenantMonth = new Map<string, number>();

  for (const f of fees) {
    const mk = monthKeyFromParts(f.year, f.month);
    if (!monthSet.has(mk)) continue;
    const amt = Number(f.amount_eur) || 0;
    if (f.property_id) {
      const k = `${f.property_id}|${mk}`;
      direct.set(k, (direct.get(k) ?? 0) + amt);
    } else {
      const k = `${f.tenant_id}|${mk}`;
      portfolioByTenantMonth.set(k, (portfolioByTenantMonth.get(k) ?? 0) + amt);
    }
  }

  const rows = report.rows.map((row) => {
    const tid = propertyTenantMap.get(row.propertyId);
    let fee = 0;
    if (tid) {
      fee = direct.get(`${row.propertyId}|${row.monthKey}`) ?? 0;
      const portTotal = portfolioByTenantMonth.get(`${tid}|${row.monthKey}`) ?? 0;
      if (portTotal > 0) {
        const sameTenantSameMonth = report.rows.filter(
          (r) => r.monthKey === row.monthKey && propertyTenantMap.get(r.propertyId) === tid,
        );
        const tenantRev = sameTenantSameMonth.reduce((s, r) => s + r.revenue.total, 0);
        const share =
          tenantRev > 0
            ? portTotal * (row.revenue.total / tenantRev)
            : sameTenantSameMonth.length > 0
              ? portTotal / sameTenantSameMonth.length
              : portTotal;
        fee += share;
      }
    }

    const baseNet =
      row.netIncomeAfterAdminAllocation != null ? row.netIncomeAfterAdminAllocation : row.netIncome;
    const netIncomeAfterPlatformFee = baseNet - fee;

    const netMarginPctAfterPlatformFee =
      row.revenue.total > 0
        ? (netIncomeAfterPlatformFee / row.revenue.total) * 100
        : row.revenue.total === 0 && netIncomeAfterPlatformFee === 0
          ? 0
          : null;

    return {
      ...row,
      platformManagementFee: fee,
      netIncomeAfterPlatformFee,
      netMarginPctAfterPlatformFee,
    };
  });

  const portfolioByMonth = report.portfolioByMonth.map((pm) => {
    const slice = rows.filter((r) => r.monthKey === pm.monthKey);
    const platformManagementFee = slice.reduce((s, r) => s + (r.platformManagementFee ?? 0), 0);
    const netIncomeAfterPlatformFee = pm.netIncome - platformManagementFee;
    const netMarginPctAfterPlatformFee =
      pm.revenue.total > 0
        ? (netIncomeAfterPlatformFee / pm.revenue.total) * 100
        : pm.revenue.total === 0 && netIncomeAfterPlatformFee === 0
          ? 0
          : null;
    return {
      ...pm,
      platformManagementFee,
      netIncomeAfterPlatformFee,
      netMarginPctAfterPlatformFee,
    };
  });

  return {
    ...report,
    rows,
    portfolioByMonth,
  };
}

export async function attachPlatformManagementFees(
  supabase: SupabaseClient,
  report: NetIncomeReportModel,
  allowedPropertyIds: string[],
): Promise<NetIncomeReportModel> {
  if (allowedPropertyIds.length === 0) return report;

  const { data: props, error } = await supabase
    .from("properties")
    .select("id, tenant_id")
    .in("id", allowedPropertyIds);

  if (error || !props?.length) {
    if (error && !String(error.message).includes("does not exist")) {
      console.warn("attachPlatformManagementFees: properties load", error.message);
    }
    return report;
  }

  const propertyTenantMap = new Map<string, string>();
  for (const p of props as { id: string; tenant_id: string }[]) {
    propertyTenantMap.set(p.id, p.tenant_id);
  }
  const tenantIds = [...new Set([...propertyTenantMap.values()])];

  const { data: feeRows, error: fErr } = await supabase
    .from("platform_management_fees")
    .select("id, tenant_id, property_id, year, month, amount_eur, calculation_notes")
    .in("tenant_id", tenantIds);

  if (fErr) {
    if (fErr.code === "42P01" || String(fErr.message).includes("platform_management_fees")) {
      return report;
    }
    console.warn("attachPlatformManagementFees:", fErr.message);
    return report;
  }

  const fees = (feeRows ?? []) as PlatformManagementFeeRow[];
  return mergePlatformManagementFeesIntoReport(report, fees, propertyTenantMap);
}
