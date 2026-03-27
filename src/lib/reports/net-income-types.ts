import type { PropertyCostType } from "@/lib/property-costs/constants";

export type PropertyRevenueBreakdown = {
  office: number;
  meeting: number;
  hotDesk: number;
  venue: number;
  additionalServices: number;
  total: number;
};

export type PropertyCostBreakdown = {
  cleaning: number;
  utilities: number;
  property_management: number;
  insurance: number;
  security: number;
  it_infrastructure: number;
  marketing: number;
  staff: number;
  one_off: number;
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
  }[];
};

export type PropertyCostEntryRow = {
  id: string;
  property_id: string;
  cost_type: PropertyCostType;
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
};
