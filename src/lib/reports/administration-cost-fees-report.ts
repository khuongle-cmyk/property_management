import type { SupabaseClient } from "@supabase/supabase-js";
import type { NetIncomeMonthRow, NetIncomeReportModel } from "./net-income-types";
import {
  ADMIN_FEE_TYPE_LABELS,
  PERCENTAGE_BASIS_LABELS,
  displayNameForSetting,
  displayTenantLabel,
  feeCategorySlugFromSetting,
  isLegacyFeeCategory,
} from "./admin-fee-constants";
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
  /** Counterparty that receives the fee */
  recipient_tenant_id?: string | null;
};

/**
 * Numeric inputs for percentage fees — mirrors net-income row aggregates (historical_revenue + costs total).
 */
export type AdminFeeBasis = {
  rev: number;
  office: number;
  meeting: number;
  hotDesk: number;
  virtualOffice: number;
  furniture: number;
  additionalServices: number;
  costs: number;
  /** historical_costs staff rows — percentage_basis hr_costs */
  hrStaffCosts: number;
};

type Basis = AdminFeeBasis;

export function adminFeeBasisFromNetRow(row: NetIncomeMonthRow): AdminFeeBasis {
  return {
    rev: row.revenue.total,
    office: row.revenue.office,
    meeting: row.revenue.meeting,
    hotDesk: row.revenue.hotDesk,
    virtualOffice: row.revenue.virtualOffice,
    furniture: row.revenue.furniture,
    additionalServices: row.revenue.additionalServices,
    costs: row.costs.total,
    hrStaffCosts: row.hrStaffCosts ?? 0,
  };
}

/** Amount (€) for a given percentage_basis key */
export function basisAmountFromAdminFeeBasis(basis: AdminFeeBasis, percentage_basis: string | null | undefined): number {
  const b = String(percentage_basis ?? "total_revenue");
  switch (b) {
    case "total_revenue":
      return basis.rev;
    case "total_costs":
      return basis.costs;
    case "office_rent_only":
      return basis.office;
    case "meeting_room_revenue":
      return basis.meeting;
    case "hot_desk_revenue":
      return basis.hotDesk;
    case "virtual_office_revenue":
      return basis.virtualOffice;
    case "furniture_revenue":
      return basis.furniture;
    case "additional_services_revenue":
      return basis.additionalServices;
    case "hr_costs":
      return basis.hrStaffCosts;
    default:
      return basis.rev;
  }
}

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

/** Percentage part using percentage_basis (any known revenue/cost line) */
function percentagePartFromBasis(setting: AdministrationCostSettingRow, basis: Basis): number {
  const pct = Number(setting.percentage_value);
  if (!Number.isFinite(pct) || pct <= 0 || !setting.percentage_basis) return 0;
  const base = basisAmountFromAdminFeeBasis(basis, setting.percentage_basis);
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
  return adminFeeBasisFromNetRow(row);
}

function aggregateBasis(rows: NetIncomeMonthRow[]): Basis {
  return rows.reduce(
    (acc, r) => ({
      rev: acc.rev + r.revenue.total,
      office: acc.office + r.revenue.office,
      meeting: acc.meeting + r.revenue.meeting,
      hotDesk: acc.hotDesk + r.revenue.hotDesk,
      virtualOffice: acc.virtualOffice + r.revenue.virtualOffice,
      furniture: acc.furniture + r.revenue.furniture,
      additionalServices: acc.additionalServices + r.revenue.additionalServices,
      costs: acc.costs + r.costs.total,
      hrStaffCosts: acc.hrStaffCosts + (r.hrStaffCosts ?? 0),
    }),
    {
      rev: 0,
      office: 0,
      meeting: 0,
      hotDesk: 0,
      virtualOffice: 0,
      furniture: 0,
      additionalServices: 0,
      costs: 0,
      hrStaffCosts: 0,
    },
  );
}

function rowWeightForAllocation(row: NetIncomeMonthRow, percentageBasisKey: string): number {
  return basisAmountFromAdminFeeBasis(adminFeeBasisFromNetRow(row), percentageBasisKey);
}

/**
 * Split total portfolio fee across rows using the same basis as the percentage (or total revenue for fixed-only).
 */
function allocateByWeights(rows: NetIncomeMonthRow[], totalFee: number, percentageBasisKey: string): Map<string, number> {
  const out = new Map<string, number>();
  if (rows.length === 0 || totalFee === 0) return out;
  const weights = rows.map((r) => rowWeightForAllocation(r, percentageBasisKey));
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

/** Which percentage_basis key to use when splitting portfolio fees across properties */
function allocationWeightKeyForSetting(setting: AdministrationCostSettingRow): string {
  const mode = getEffectiveCalculationMode(setting);
  if (mode === "fixed") return "total_revenue";

  if (setting.fee_type === "percentage_of_costs") return "total_costs";

  return String(setting.percentage_basis ?? "total_revenue");
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

/**
 * Fee applies to this payer org (property tenant) if:
 * - Canonical: `tenant_id` is the payer (operator / property org).
 * - Platform-billed (legacy): `tenant_id` is the billing org (e.g. VillageWorks) and `recipient_tenant_id` is the payer org.
 */
export function administrationSettingAppliesToPayerTenant(
  s: AdministrationCostSettingRow,
  payerTenantId: string,
): boolean {
  if (s.tenant_id === payerTenantId) return true;
  const rec = String(s.recipient_tenant_id ?? "").trim();
  return rec === payerTenantId && s.tenant_id !== payerTenantId;
}

/** True when the row stores billing org in `tenant_id` and payer org in `recipient_tenant_id`. */
export function administrationSettingIsInvertedPayerRecipient(
  s: AdministrationCostSettingRow,
  payerTenantId: string,
): boolean {
  const rec = String(s.recipient_tenant_id ?? "").trim();
  return rec === payerTenantId && s.tenant_id !== payerTenantId;
}

function settingCouldApplyToRow(
  s: AdministrationCostSettingRow,
  row: NetIncomeMonthRow,
  payerTenantId: string,
): boolean {
  if (!administrationSettingAppliesToPayerTenant(s, payerTenantId)) return false;
  if (s.property_id) return s.property_id === row.propertyId;
  return true;
}

function buildAdminFeeReportLine(
  setting: AdministrationCostSettingRow,
  amount: number,
  tenantNameById: Map<string, string>,
  payerTenantId: string,
): {
  settingId: string;
  name: string;
  amount: number;
  reportPrimary: string;
  reportSubtext?: string;
} {
  const cat = feeCategorySlugFromSetting(setting);
  const typeLabel = ADMIN_FEE_TYPE_LABELS[cat] ?? displayNameForSetting(setting);
  const inverted = administrationSettingIsInvertedPayerRecipient(setting, payerTenantId);
  const payerId = inverted ? payerTenantId : setting.tenant_id;
  const recipientId = inverted
    ? setting.tenant_id
    : setting.recipient_tenant_id != null && String(setting.recipient_tenant_id).trim() !== ""
      ? String(setting.recipient_tenant_id).trim()
      : null;
  const payerName = displayTenantLabel(tenantNameById.get(payerId) ?? null);
  const recipientRaw = recipientId ? tenantNameById.get(recipientId) : null;
  const recipientDisp = recipientRaw ? displayTenantLabel(recipientRaw) : null;
  const reportPrimary = `${typeLabel} → ${recipientDisp ?? "—"}`;
  const reportSubtext = `Recipient: ${recipientDisp ?? "—"}\nPaid by: ${payerName}`;
  return {
    settingId: setting.id,
    name: displayNameForSetting(setting),
    amount,
    reportPrimary,
    reportSubtext,
  };
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
  tenantNameById: Map<string, string>,
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
    const portfolioSettings = active.filter((s) => !s.property_id && administrationSettingAppliesToPayerTenant(s, tid));
    for (const setting of portfolioSettings) {
      const total = portfolioFeeTotal(setting, rowsInGroup);
      if (total === 0) continue;
      const weightKey = allocationWeightKeyForSetting(setting);
      const alloc = allocateByWeights(rowsInGroup, total, weightKey);
      for (const r of rowsInGroup) {
        const amt = alloc.get(`${r.propertyId}|${r.monthKey}`) ?? 0;
        amountByKey.set(`${r.propertyId}|${r.monthKey}|${setting.id}`, amt);
      }
    }
  }

  for (const row of report.rows) {
    const tid = propertyTenantMap.get(row.propertyId);
    if (!tid) continue;
    const direct = active.filter(
      (s) =>
        s.property_id === row.propertyId && administrationSettingAppliesToPayerTenant(s, tid),
    );
    for (const setting of direct) {
      const amt = propertyFeeAmount(setting, row);
      amountByKey.set(`${row.propertyId}|${row.monthKey}|${setting.id}`, amt);
    }
  }

  const rows: NetIncomeMonthRow[] = report.rows.map((row) => {
    const tid = propertyTenantMap.get(row.propertyId);
    const lines: {
      settingId: string;
      name: string;
      amount: number;
      reportPrimary?: string;
      reportSubtext?: string;
    }[] = [];
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

    const relevant = active.filter((s) => settingCouldApplyToRow(s, row, tid));
    let totalFees = 0;
    for (const setting of relevant) {
      const amt = amountByKey.get(`${row.propertyId}|${row.monthKey}|${setting.id}`) ?? 0;
      if (amt === 0) continue;
      lines.push(buildAdminFeeReportLine(setting, amt, tenantNameById, tid));
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
  if (tenantIds.length === 0) return report;

  const selectCols =
    "id, tenant_id, property_id, name, fee_type, custom_name, calculation_mode, fixed_amount, fixed_period, percentage_value, percentage_basis, minimum_fee, maximum_fee, is_active, recipient_tenant_id";

  const [byPayerKey, byRecipientKey] = await Promise.all([
    supabase.from("administration_cost_settings").select(selectCols).in("tenant_id", tenantIds),
    supabase.from("administration_cost_settings").select(selectCols).in("recipient_tenant_id", tenantIds),
  ]);

  const sErr = byPayerKey.error ?? byRecipientKey.error;
  if (sErr) {
    if (sErr.code === "42P01" || String(sErr.message).includes("administration_cost_settings")) {
      return report;
    }
    console.warn("attachAdministrationCostFees:", sErr.message);
    return report;
  }

  const mergedById = new Map<string, AdministrationCostSettingRow>();
  for (const row of [...(byPayerKey.data ?? []), ...(byRecipientKey.data ?? [])] as AdministrationCostSettingRow[]) {
    mergedById.set(row.id, row);
  }
  const settings = [...mergedById.values()];

  const nameIds = new Set<string>();
  for (const s of settings) {
    nameIds.add(s.tenant_id);
    const rid = s.recipient_tenant_id != null ? String(s.recipient_tenant_id).trim() : "";
    if (rid) nameIds.add(rid);
  }
  let tenantNameById = new Map<string, string>();
  if (nameIds.size > 0) {
    const { data: tRows, error: tErr } = await supabase
      .from("tenants")
      .select("id, name")
      .in("id", [...nameIds]);
    if (!tErr && tRows) {
      tenantNameById = new Map(
        (tRows as { id: string; name: string | null }[]).map((t) => [t.id, (t.name ?? "").trim() || t.id]),
      );
    }
  }

  /** Same staff P&L subtotal as net income (staff_costs + staff_benefits buckets, incl. account-code mapping). */
  const reportWithStaff: NetIncomeReportModel = {
    ...report,
    rows: report.rows.map((row) => ({
      ...row,
      hrStaffCosts: row.costs.staff_costs + row.costs.staff_benefits,
    })),
  };

  return mergeAdministrationCostSettingsIntoReport(reportWithStaff, settings, propertyTenantMap, tenantNameById);
}
