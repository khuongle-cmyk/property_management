import type { VatBreakdown } from "./vat-finland";

export type DataBasis = "actual" | "forecast" | "mixed";

export type DataSourceAttribution = {
  id: string;
  label: string;
  detail: string;
  basisActualVsForecast: string;
  lastRelevantUpdate: string;
};

export type ProfessionalReportMeta = {
  brandName: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  reportTitle: string;
  reportKind: "rent_roll" | "net_income";
  periodStart: string;
  periodEnd: string;
  monthCount: number;
  generatedAtIso: string;
  generatedByEmail: string | null;
  generatedByUserId: string;
  /** Primary properties covered */
  propertyLines: { id: string; name: string; addressLine: string }[];
  dataQualityNotes: string[];
  /** Printed assumptions (VAT, rounding, etc.) */
  assumptions: string[];
};

export type ExecutiveKpis = {
  /** Ex-VAT */
  totalRevenueNet: number;
  vatOnRevenue: number;
  totalRevenueGross: number;
  /** Ex-VAT operating costs (net income pack only) */
  totalCostsNet?: number;
  vatOnCosts?: number;
  totalCostsGross?: number;
  /** Ex-VAT */
  netOperatingResult?: number;
  netMarginPct?: number | null;
  avgMonthlyRevenueNet: number;
  /** Simple run-rate from last 3 portfolio months in range */
  indicativeAnnualRevenueNet: number | null;
  indicativeAnnualNetResult?: number | null;
  occupancyWeightedPct: number | null;
  occupancyNote: string;
  /** Sparkline data */
  revenueNetByMonth: { monthKey: string; net: number; basis: DataBasis }[];
  netResultByMonth?: { monthKey: string; net: number; basis: DataBasis }[];
};

export type VatSummaryLine = {
  section: string;
  category: string;
  ratePct: number;
} & VatBreakdown;

export type MonthlyRevenueVatRow = {
  monthKey: string;
  basis: DataBasis;
  office: VatBreakdown;
  meeting: VatBreakdown;
  hotDesk: VatBreakdown;
  venue: VatBreakdown;
  additionalServices: VatBreakdown;
  total: VatBreakdown;
};

export type ProfessionalRentRollPack = {
  meta: ProfessionalReportMeta;
  executive: ExecutiveKpis;
  dataSources: DataSourceAttribution[];
  monthlyRevenueVat: MonthlyRevenueVatRow[];
  vatSummaryLines: VatSummaryLine[];
  /** Output vs input VAT (indicative) */
  netVatPositionIndicative: number;
};

export type MonthlyNetIncomeVatRow = {
  monthKey: string;
  basis: DataBasis;
  revenue: VatBreakdown;
  costs: VatBreakdown;
  netOperatingExVat: number;
};

export type ProfessionalNetIncomePack = {
  meta: ProfessionalReportMeta;
  executive: ExecutiveKpis;
  dataSources: DataSourceAttribution[];
  monthlyRows: MonthlyNetIncomeVatRow[];
  vatSummaryLines: VatSummaryLine[];
  netVatPositionIndicative: number;
};
