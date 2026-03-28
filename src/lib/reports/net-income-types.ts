import type { PropertyCostType } from "@/lib/property-costs/constants";

export type PropertyRevenueBreakdown = {
  office: number;
  meeting: number;
  hotDesk: number;
  venue: number;
  virtualOffice: number;
  furniture: number;
  additionalServices: number;
  total: number;
};

/** P&L-style cost buckets (historical account codes + legacy property cost types). */
export type PropertyCostBreakdown = {
  purchases: number;
  subcontracting: number;
  rent: number;
  electricity: number;
  premises_costs: number;
  staff_costs: number;
  staff_benefits: number;
  equipment_costs: number;
  travel: number;
  sales_costs: number;
  marketing: number;
  accounting_fees: number;
  admin_costs: number;
  /** 9160 and similar credits — subtracted in total via computeCostsTotal */
  financial_income: number;
  financial_costs: number;
  other: number;
  total: number;
};

export type NetIncomeMonthRow = {
  propertyId: string;
  propertyName: string;
  monthKey: string;
  revenue: PropertyRevenueBreakdown;
  costs: PropertyCostBreakdown;
  netIncome: number;
  netMarginPct: number | null;
  /** scheduled vs confirmed cost totals for transparency */
  costsScheduled: number;
  costsConfirmed: number;
  /** When administration is allocated by portfolio revenue share */
  allocatedAdministrationCost?: number;
  netIncomeAfterAdminAllocation?: number;
  /** Per configured administration fee line (platform-set); amounts reduce net after NOI */
  administrationFees?: { settingId: string; name: string; amount: number }[];
  /** Sum of administrationFees for this row */
  administrationFeesTotal?: number;
  /** NOI (or after HQ admin allocation) minus administration fee lines */
  netIncomeAfterAdminFees?: number;
  /** Margin after admin fees */
  netMarginPctAfterAdminFees?: number | null;
};

export type NetIncomeReportModel = {
  generatedAt: string;
  startDate: string;
  endDate: string;
  monthKeys: string[];
  properties: { id: string; name: string; city: string | null }[];
  rows: NetIncomeMonthRow[];
  /** Optional portfolio roll-up by month */
  portfolioByMonth: {
    monthKey: string;
    revenue: PropertyRevenueBreakdown;
    costs: PropertyCostBreakdown;
    netIncome: number;
    netMarginPct: number | null;
    administrationFeesTotal?: number;
    netIncomeAfterAdminFees?: number;
    netMarginPctAfterAdminFees?: number | null;
  }[];
  /** When includeAdministrationInTrueNet: central / HQ costs by month */
  administrationByMonth?: {
    monthKey: string;
    costs: PropertyCostBreakdown;
    total: number;
  }[];
  /** Portfolio true net = property NOI − administration (same month) */
  trueNetPortfolioByMonth?: {
    monthKey: string;
    propertyNoi: number;
    administrationTotal: number;
    netIncome: number;
    netMarginPct: number | null;
  }[];
};

export type PropertyCostEntryRow = {
  id: string;
  /** Null for organization-level administration costs (historical imports). */
  property_id: string | null;
  /** Legacy UI types or synthetic bucket name; bucket resolution uses account_code when set. */
  cost_type: PropertyCostType | string;
  description: string;
  amount: number;
  cost_date: string;
  period_month: string;
  supplier_name: string | null;
  invoice_number: string | null;
  notes: string | null;
  status: "scheduled" | "confirmed" | "cancelled";
  source: "manual" | "csv" | "recurring";
  recurring_template_id: string | null;
  /** Present on historical_costs imports — drives P&L categorization. */
  account_code?: string | null;
  /** Organization central costs (not attributed to a property). */
  cost_scope?: "property" | "administration";
};
