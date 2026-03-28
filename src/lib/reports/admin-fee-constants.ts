/**
 * Fee category slug (stored in fee_type + custom_name for new rows).
 */
export const ADMIN_FEE_TYPES = [
  "management_fee",
  "administration_cost",
  "overhead_allocation",
  "property_management_fee",
  "asset_management_fee",
  "platform_fee",
  "service_charge",
  "other",
] as const;

export type AdminFeeType = (typeof ADMIN_FEE_TYPES)[number];

export const ADMIN_FEE_TYPE_LABELS: Record<string, string> = {
  management_fee: "Management fee",
  administration_cost: "Administration cost",
  overhead_allocation: "Overhead allocation",
  property_management_fee: "Property management fee",
  asset_management_fee: "Asset management fee",
  platform_fee: "Platform fee",
  service_charge: "Service charge",
  other: "Other",
};

export const DEFAULT_NAME_BY_FEE_TYPE: Record<string, string> = { ...ADMIN_FEE_TYPE_LABELS };

/** Stored in administration_cost_settings.calculation_mode */
export const FEE_CALC_MODES = ["fixed", "percentage", "combination"] as const;
export type FeeCalcMode = (typeof FEE_CALC_MODES)[number];

export const FEE_CALC_MODE_LABELS: Record<string, string> = {
  fixed: "Fixed amount",
  percentage: "Percentage",
  combination: "Fixed + Percentage",
};

export const FIXED_PERIODS = ["monthly", "annual"] as const;
export type FixedPeriod = (typeof FIXED_PERIODS)[number];

/** Stored in administration_cost_settings.percentage_basis — aligned with net-income revenue/cost lines */
export const PERCENTAGE_BASES = [
  "total_revenue",
  "total_costs",
  "office_rent_only",
  "meeting_room_revenue",
  "hot_desk_revenue",
  "virtual_office_revenue",
  "furniture_revenue",
  "additional_services_revenue",
  "hr_costs",
] as const;
export type PercentageBasis = (typeof PERCENTAGE_BASES)[number];

export const PERCENTAGE_BASIS_LABELS: Record<string, string> = {
  total_revenue: "Total revenue",
  total_costs: "Total costs",
  office_rent_only: "Office rent only",
  meeting_room_revenue: "Meeting room revenue",
  hot_desk_revenue: "Hot desk revenue",
  virtual_office_revenue: "Virtual office revenue",
  furniture_revenue: "Furniture revenue",
  additional_services_revenue: "Additional services revenue",
  hr_costs: "HR costs (staff only)",
};

const LEGACY_CATEGORY = new Set<string>(ADMIN_FEE_TYPES);

/** True when value is a fee *category* slug (management_fee, …), not a calculation mode */
export function isLegacyFeeCategory(feeType: string | null | undefined): boolean {
  if (!feeType) return false;
  return LEGACY_CATEGORY.has(feeType);
}

export function displayNameForSetting(s: {
  custom_name?: string | null;
  name?: string | null;
  fee_type?: string | null;
}): string {
  const n = (s.name ?? "").trim();
  if (n) return n;
  const cat = (s.custom_name ?? "").trim();
  if (cat && ADMIN_FEE_TYPE_LABELS[cat]) return ADMIN_FEE_TYPE_LABELS[cat];
  if (cat) return cat;
  const t = (s.fee_type ?? "").trim();
  if (isLegacyFeeCategory(t)) return ADMIN_FEE_TYPE_LABELS[t] ?? t.replace(/_/g, " ");
  return "Admin fee";
}

export function listColumnCalculationLabel(row: {
  calculation_mode?: string | null;
  fee_type?: string | null;
}): string {
  const cm = row.calculation_mode?.trim();
  if (cm === "fixed" || cm === "percentage" || cm === "combination") {
    return FEE_CALC_MODE_LABELS[cm] ?? cm;
  }
  const ft = row.fee_type?.trim() ?? "";
  if (ft === "fixed_amount") return FEE_CALC_MODE_LABELS.fixed;
  if (ft === "percentage_of_revenue" || ft === "percentage_of_costs") return FEE_CALC_MODE_LABELS.percentage;
  if (ft === "fixed_plus_percentage") return FEE_CALC_MODE_LABELS.combination;
  if (isLegacyFeeCategory(ft)) return "Legacy";
  if (ft) return ft.replace(/_/g, " ");
  return "—";
}
