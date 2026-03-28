import type { SupabaseClient } from "@supabase/supabase-js";
import type { NetIncomeMonthRow, NetIncomeReportModel } from "./net-income-types";
import { PERCENTAGE_BASIS_LABELS, displayNameForSetting, isLegacyFeeCategory } from "./admin-fee-constants";
import type { FeeCalcMode } from "./admin-fee-constants";

export type AdministrationCostSettingRow = {
  id: string;
  tenant_id: string;
  property_id: string | null;
  name: string | null;
  fee_type: string | null;
  custom_name: string | null;
  /** fixed | percentage | combination */
  calculation_mode?: string | null;
  fixed_amount: number | null;
  fixed_period: string | null;
  percentage_value: number | null;
  percentage_basis: string | null;
  minimum_fee: number | null;
  maximum_fee: number | null;
  is_active: boolean | null;
};

export type AdminFeeBasis = { rev: number; office: number; costs: number };
type Basis = AdminFeeBasis;

export function clampAdminFeeAmount(raw: number, min: number | null | undefined, max: number | null | undefined): number {
  let x = raw;
  if (min != null && Number.isFinite(min)) x = Math.max(x, min);
  if (max != null && Number.isFinite(max)) x = Math.min(x, max);
  return x;
}

function fixedMonthlyPart(setting: AdministrationCostSettingRow): number {
  const fixed = Number(setting.fixed_amount);
  if (!Number.isFinite(fixed) || fixed <= 0) return 0;
  const period = String(setting.fixed_period ?? "monthly").toLowerCase();
  if (period === "annual") return fixed / 12;
  return fixed;
}

/** Percentage part using percentage_basis on revenue-side bases (total revenue, office, or costs as basis) */
function percentagePartFromBasis(setting: AdministrationCostSettingRow, basis: Basis): number {
  const pct = Number(setting.percentage_value);
  if (!Number.isFinite(pct) || pct <= 0 || !setting.percentage_basis) return 0;
  const b = setting.percentage_basis;
  let base = basis.rev;
  if (b === "office_rent_only") base = basis.office;
  else if (b === "total_costs") base = basis.costs;
  return (pct / 100) * base;
}

/**
 * Effective calculation mode: prefers `calculation_mode`, then legacy values in `fee_type`,
 * then inference from amounts for legacy category rows.
 */
export function getEffectiveCalculationMode(s: AdministrationCostSettingRow): FeeCalcMode {
  const cm = s.calculation_mode?.trim();
  if (cm === "fixed" || cm === "percentage" || cm === "combination") return cm;

  const ft = s.fee_type?.trim() ?? "";
  if (ft === "fixed_amount") return "fixed";
  if (ft === "percentage_of_revenue" || ft === "percentage_of_costs") return "percentage";
  if (ft === "fixed_plus_percentage") return "combination";

  if (isLegacyFeeCategory(ft)) {
    return inferFeeModeFromAmounts(s);
  }
  return inferFeeModeFromAmounts(s);
}

function inferFeeModeFromAmounts(s: AdministrationCostSettingRow): FeeCalcMode {
  const pct = Number(s.percentage_value);
  const pctOk = Number.isFinite(pct) && pct > 0;
  const legacyCosts = s.fee_type === "percentage_of_costs";
  const hasPct = pctOk && (legacyCosts || Boolean(s.percentage_basis?.trim()));
  const hasFixed = Number(s.fixed_amount) > 0;
  if (hasPct && hasFixed) return "combination";
  if (hasPct) return "percentage";
  return "fixed";
}

/** @deprecated Use getEffectiveCalculationMode */
export function inferLegacyCalculationMode(s: AdministrationCostSettingRow): FeeCalcMode {
  return getEffectiveCalculationMode(s);
}

/** Raw percentage component (monthly); respects legacy `percentage_of_costs` stored in fee_type */
function percentageFeePart(setting: AdministrationCostSettingRow, basis: Basis): number {
  const pct = Number(setting.percentage_value);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  if (setting.fee_type === "percentage_of_costs") {
    return (pct / 100) * basis.costs;
  }
  if (!setting.percentage_basis) return 0;
  return percentagePartFromBasis(setting, basis);
}

/** Raw fee before min/max; for one row basis or aggregate basis */
export function computeRawAdminFee(setting: AdministrationCostSettingRow, basis: Basis): number {
  const mode = getEffectiveCalculationMode(setting);
  const fixed = fixedMonthlyPart(setting);
  const pctPart = percentageFeePart(setting, basis);

  if (mode === "fixed") return fixed;
  if (mode === "percentage") return pctPart;
  return fixed + pctPart;
}

function basisFromRow(row: NetIncomeMonthRow): Basis {
  return {
    rev: row.revenue.total,
    office: row.revenue.office,
    costs: row.costs.total,
  };
}

function aggregateBasis(rows: NetIncomeMonthRow[]): Basis {
  return rows.reduce(
    (acc, r) => ({
      rev: acc.rev + r.revenue.total,
      office: acc.office + r.revenue.office,
      costs: acc.costs + r.costs.total,
    }),
    { rev: 0, office: 0, costs: 0 },
  );
}

/**
 * Split total portfolio fee across rows using revenue, office, or cost share.
 */
function allocateByWeights(
  rows: NetIncomeMonthRow[],
  totalFee: number,
  mode: "revenue" | "office" | "costs",
): Map<string, number> {
  const out = new Map<string, number>();
  if (rows.length === 0 || totalFee === 0) return out;
  const weights = rows.map((r) => {
    if (mode === "office") return r.revenue.office;
    if (mode === "costs") return r.costs.total;
    return r.revenue.total;
  });
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) {
    const each = totalFee / rows.length;
    for (const r of rows) {
      out.set(`${r.propertyId}|${r.monthKey}`, each);
    }
    return out;
  }
  let allocated = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const isLast = i === rows.length - 1;
    const share = isLast ? totalFee - allocated : (totalFee * weights[i]) / sumW;
    const rounded = isLast ? totalFee - allocated : Math.round(share * 100) / 100;
    allocated += rounded;
    out.set(`${r.propertyId}|${r.monthKey}`, rounded);
  }
  return out;
}

function allocationModeForSetting(setting: AdministrationCostSettingRow): "revenue" | "office" | "costs" {
  const mode = getEffectiveCalculationMode(setting);
  if (mode === "fixed") return "revenue";

  if (setting.fee_type === "percentage_of_costs") return "costs";

  const b = String(setting.percentage_basis ?? "total_revenue");
  if (b === "office_rent_only") return "office";
  if (b === "total_costs") return "costs";
  return "revenue";
}

function portfolioFeeTotal(setting: AdministrationCostSettingRow, rowsInMonth: NetIncomeMonthRow[]): number {
  const agg = aggregateBasis(rowsInMonth);
  const raw = computeRawAdminFee(setting, agg);
  return clampAdminFeeAmount(raw, setting.minimum_fee, setting.maximum_fee);
}

function propertyFeeAmount(setting: AdministrationCostSettingRow, row: NetIncomeMonthRow): number {
  const raw = computeRawAdminFee(setting, basisFromRow(row));
  return clampAdminFeeAmount(raw, setting.minimum_fee, setting.maximum_fee);
}

/** Client / preview: same formula as report rows for a given revenue/cost basis */
export function computeClampedAdminFeeForBasis(
  setting: Pick<
    AdministrationCostSettingRow,
    | "fee_type"
    | "calculation_mode"
    | "fixed_amount"
    | "fixed_period"
    | "percentage_value"
    | "percentage_basis"
    | "minimum_fee"
    | "maximum_fee"
  >,
  basis: Basis,
): number {
  const raw = computeRawAdminFee(setting as AdministrationCostSettingRow, basis);
  return clampAdminFeeAmount(raw, setting.minimum_fee, setting.maximum_fee);
}

function moneyFmt(n: number): string {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(n);
}

/** List column: Amount / % */
export function formatAdminFeeAmountOrPercent(s: AdministrationCostSettingRow): string {
  const mode = getEffectiveCalculationMode(s);
  const pct = Number(s.percentage_value);

  if (mode === "fixed") {
    const f = Number(s.fixed_amount);
    if (!(f > 0)) return "—";
    const ann = String(s.fixed_period ?? "monthly").toLowerCase() === "annual";
    return `${moneyFmt(f)} (${ann ? "annual" : "monthly"})`;
  }

  if (mode === "percentage") {
    if (!Number.isFinite(pct) || pct <= 0) return "—";
    if (s.fee_type === "percentage_of_costs") return `${pct}% of costs`;
    const basis = PERCENTAGE_BASIS_LABELS[s.percentage_basis ?? ""] ?? s.percentage_basis ?? "";
    return `${pct}% (${basis})`;
  }

  if (mode === "combination") {
    const fx = fixedMonthlyPart(s);
    if (s.fee_type === "percentage_of_costs") {
      return `${moneyFmt(fx)}/mo + ${pct}% of costs`;
    }
    const basis = PERCENTAGE_BASIS_LABELS[s.percentage_basis ?? ""] ?? s.percentage_basis ?? "";
    return `${moneyFmt(fx)}/mo + ${pct}% (${basis})`;
  }

  return "—";
}

/**
 * Net = Revenue − costs − administration fees (applied after optional admin HQ allocation).
 */
export function mergeAdministrationCostSettingsIntoReport(
  report: NetIncomeReportModel,
  settings: AdministrationCostSettingRow[],
  propertyTenantMap: Map<string, string>,
): NetIncomeReportModel {
  const active = settings.filter((s) => s.is_active !== false);

  const groupMap = new Map<string, NetIncomeMonthRow[]>();
  for (const row of report.rows) {
    const tid = propertyTenantMap.get(row.propertyId);
    if (!tid) continue;
    const gkey = `${tid}::${row.monthKey}`;
    if (!groupMap.has(gkey)) groupMap.set(gkey, []);
    groupMap.get(gkey)!.push(row);
  }

  /** `${propertyId}|${monthKey}|${settingId}` -> amount */
  const amountByKey = new Map<string, number>();

  for (const [, rowsInGroup] of groupMap) {
    const tid = propertyTenantMap.get(rowsInGroup[0].propertyId);
    if (!tid) continue;
    const portfolioSettings = active.filter((s) => s.tenant_id === tid && !s.property_id);
    for (const setting of portfolioSettings) {
      const total = portfolioFeeTotal(setting, rowsInGroup);
      if (total === 0) continue;
      const mode = allocationModeForSetting(setting);
      const alloc = allocateByWeights(rowsInGroup, total, mode);
      for (const r of rowsInGroup) {
        const amt = alloc.get(`${r.propertyId}|${r.monthKey}`) ?? 0;
        amountByKey.set(`${r.propertyId}|${r.monthKey}|${setting.id}`, amt);
      }
    }
  }

  for (const row of report.rows) {
    const tid = propertyTenantMap.get(row.propertyId);
    if (!tid) continue;
    const direct = active.filter((s) => s.tenant_id === tid && s.property_id === row.propertyId);
    for (const setting of direct) {
      const amt = propertyFeeAmount(setting, row);
      amountByKey.set(`${row.propertyId}|${row.monthKey}|${setting.id}`, amt);
    }
  }

  const rows: NetIncomeMonthRow[] = report.rows.map((row) => {
    const tid = propertyTenantMap.get(row.propertyId);
    const lines: { settingId: string; name: string; amount: number }[] = [];
    if (!tid) {
      const baseNet = row.netIncomeAfterAdminAllocation ?? row.netIncome;
      return {
        ...row,
        administrationFees: undefined,
        administrationFeesTotal: undefined,
        netIncomeAfterAdminFees: baseNet,
        netMarginPctAfterAdminFees: row.netMarginPct,
      };
    }

    const relevant = active.filter((s) => s.tenant_id === tid);
    let totalFees = 0;
    for (const setting of relevant) {
      const amt = amountByKey.get(`${row.propertyId}|${row.monthKey}|${setting.id}`) ?? 0;
      if (amt === 0) continue;
      lines.push({
        settingId: setting.id,
        name: displayNameForSetting(setting),
        amount: amt,
      });
      totalFees += amt;
    }

    const baseNet = row.netIncomeAfterAdminAllocation ?? row.netIncome;
    const netIncomeAfterAdminFees = baseNet - totalFees;
    const netMarginPctAfterAdminFees =
      row.revenue.total > 0
        ? (netIncomeAfterAdminFees / row.revenue.total) * 100
        : row.revenue.total === 0 && netIncomeAfterAdminFees === 0
          ? 0
          : null;

    return {
      ...row,
      administrationFees: lines.length ? lines : undefined,
      administrationFeesTotal: totalFees > 0 ? totalFees : undefined,
      netIncomeAfterAdminFees,
      netMarginPctAfterAdminFees,
    };
  });

  const portfolioByMonth = report.portfolioByMonth.map((pm) => {
    const slice = rows.filter((r) => r.monthKey === pm.monthKey);
    const administrationFeesTotal = slice.reduce((s, r) => s + (r.administrationFeesTotal ?? 0), 0);
    const netIncomeAfterAdminFees = pm.netIncome - administrationFeesTotal;
    const netMarginPctAfterAdminFees =
      pm.revenue.total > 0
        ? (netIncomeAfterAdminFees / pm.revenue.total) * 100
        : pm.revenue.total === 0 && netIncomeAfterAdminFees === 0
          ? 0
          : null;
    return {
      ...pm,
      administrationFeesTotal,
      netIncomeAfterAdminFees,
      netMarginPctAfterAdminFees,
    };
  });

  return {
    ...report,
    rows,
    portfolioByMonth,
  };
}

export async function attachAdministrationCostFees(
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
      console.warn("attachAdministrationCostFees: properties load", error.message);
    }
    return report;
  }

  const propertyTenantMap = new Map<string, string>();
  for (const p of props as { id: string; tenant_id: string }[]) {
    propertyTenantMap.set(p.id, p.tenant_id);
  }
  const tenantIds = [...new Set([...propertyTenantMap.values()])];

  const { data: settingRows, error: sErr } = await supabase
    .from("administration_cost_settings")
    .select(
      "id, tenant_id, property_id, name, fee_type, custom_name, calculation_mode, fixed_amount, fixed_period, percentage_value, percentage_basis, minimum_fee, maximum_fee, is_active",
    )
    .in("tenant_id", tenantIds);

  if (sErr) {
    if (sErr.code === "42P01" || String(sErr.message).includes("administration_cost_settings")) {
      return report;
    }
    console.warn("attachAdministrationCostFees:", sErr.message);
    return report;
  }

  const settings = (settingRows ?? []) as AdministrationCostSettingRow[];
  return mergeAdministrationCostSettingsIntoReport(report, settings, propertyTenantMap);
}
