import type { NetIncomeReportModel } from "./net-income-types";
import type {
  DataBasis,
  DataSourceAttribution,
  ExecutiveKpis,
  MonthlyNetIncomeVatRow,
  ProfessionalNetIncomePack,
  ProfessionalReportMeta,
  VatSummaryLine,
} from "./professional-types";
import type { ReportExportContext } from "./report-export-context";
import { formatPropertyAddress } from "./report-export-context";
import {
  VAT_FINLAND_GENERAL,
  VAT_FINLAND_REDUCED_SERVICES,
  roundMoney2,
  sumVatBreakdowns,
  vatFromNet,
} from "./vat-finland";

function basisForMonth(monthKey: string, asOf: Date): DataBasis {
  const [y, m] = monthKey.split("-").map(Number);
  const endOfMonth = Date.UTC(y, m, 0, 23, 59, 59, 999);
  const startOfToday = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  if (endOfMonth < startOfToday) return "actual";
  const startOfMonth = Date.UTC(y, m - 1, 1);
  if (startOfMonth > startOfToday) return "forecast";
  return "mixed";
}

function revenueVatBreakdown(rev: NetIncomeReportModel["portfolioByMonth"][0]["revenue"]) {
  const office = vatFromNet(rev.office, VAT_FINLAND_GENERAL, "25.5%");
  const meeting = vatFromNet(rev.meeting, VAT_FINLAND_REDUCED_SERVICES, "10% reduced");
  const hotDesk = vatFromNet(rev.hotDesk, VAT_FINLAND_REDUCED_SERVICES, "10% reduced");
  const venue = vatFromNet(rev.venue, VAT_FINLAND_REDUCED_SERVICES, "10% reduced");
  const virtualOffice = vatFromNet(rev.virtualOffice ?? 0, VAT_FINLAND_GENERAL, "25.5%");
  const furniture = vatFromNet(rev.furniture ?? 0, VAT_FINLAND_GENERAL, "25.5%");
  const additionalServices = vatFromNet(rev.additionalServices, VAT_FINLAND_GENERAL, "25.5%");
  return sumVatBreakdowns([office, meeting, hotDesk, venue, virtualOffice, furniture, additionalServices]);
}

function costsVatBreakdown(costs: NetIncomeReportModel["portfolioByMonth"][0]["costs"]) {
  return vatFromNet(costs.total, VAT_FINLAND_GENERAL, "25.5% on costs (model)");
}

export function buildProfessionalNetIncomePack(
  report: NetIncomeReportModel,
  ctx: ReportExportContext,
): ProfessionalNetIncomePack {
  const asOf = new Date();

  const propertyLines = ctx.properties
    .filter((p) => report.properties.some((rp) => rp.id === p.id))
    .map((p) => ({
      id: p.id,
      name: p.name ?? "—",
      addressLine: formatPropertyAddress(p),
    }));

  const scheduledNotes = report.rows.some((r) => r.costsScheduled > 0);
  const dataQualityNotes: string[] = [];
  if (scheduledNotes) {
    dataQualityNotes.push("Scheduled recurring cost lines are included as forecasts until confirmed on the property costs page.");
  }

  const meta: ProfessionalReportMeta = {
    brandName: ctx.brandName,
    logoUrl: ctx.logoUrl,
    coverImageUrl: ctx.coverImageUrl,
    reportTitle: "Net income report",
    reportKind: "net_income",
    periodStart: report.startDate,
    periodEnd: report.endDate,
    monthCount: report.monthKeys.length,
    generatedAtIso: asOf.toISOString(),
    generatedByEmail: ctx.generatedByEmail,
    generatedByUserId: ctx.generatedByUserId,
    propertyLines: propertyLines.length ? propertyLines : report.properties.map((p) => ({ id: p.id, name: p.name, addressLine: p.city ?? "" })),
    dataQualityNotes,
    assumptions: [
      "Revenue and costs modeled ex-VAT (net) with Finnish VAT reference rates for gross/VAT presentation (verify all classifications).",
      "Net operating result = revenue (ex-VAT) − operating costs (ex-VAT); pass-through VAT summarized separately.",
      "Costs combine confirmed and scheduled lines; scheduled items are forecasts.",
      "Not a statutory filing. Management use only.",
    ],
  };

  const monthlyRows: MonthlyNetIncomeVatRow[] = report.portfolioByMonth.map((pm) => {
    const rev = revenueVatBreakdown(pm.revenue);
    const costs = costsVatBreakdown(pm.costs);
    const af = pm.administrationFeesTotal;
    const netAfter = pm.netIncomeAfterAdminFees;
    const row: MonthlyNetIncomeVatRow = {
      monthKey: pm.monthKey,
      basis: basisForMonth(pm.monthKey, asOf),
      revenue: rev,
      costs,
      netOperatingExVat: roundMoney2(pm.netIncome),
    };
    if (af != null && af > 0) {
      row.administrationFeesExVat = roundMoney2(af);
      row.netAfterAdminFeesExVat = netAfter != null ? roundMoney2(netAfter) : roundMoney2(pm.netIncome - af);
    }
    return row;
  });

  const totalRevNet = roundMoney2(report.portfolioByMonth.reduce((s, r) => s + r.revenue.total, 0));
  const totalCostsNet = roundMoney2(report.portfolioByMonth.reduce((s, r) => s + r.costs.total, 0));
  const totalNet = roundMoney2(totalRevNet - totalCostsNet);
  const vatOnRevenue = roundMoney2(monthlyRows.reduce((s, r) => s + r.revenue.vat, 0));
  const vatOnCosts = roundMoney2(monthlyRows.reduce((s, r) => s + r.costs.vat, 0));
  const totalRevGross = roundMoney2(monthlyRows.reduce((s, r) => s + r.revenue.gross, 0));
  const totalCostsGross = roundMoney2(monthlyRows.reduce((s, r) => s + r.costs.gross, 0));

  const n = report.monthKeys.length || 1;
  const avgMonthlyRevenueNet = roundMoney2(totalRevNet / n);
  const last3 = report.portfolioByMonth.slice(-3);
  let indicativeAnnualRevenueNet: number | null = null;
  let indicativeAnnualNetResult: number | null = null;
  if (last3.length) {
    const avgRev = roundMoney2(last3.reduce((s, r) => s + r.revenue.total, 0) / last3.length);
    const avgNet = roundMoney2(last3.reduce((s, r) => s + r.netIncome, 0) / last3.length);
    indicativeAnnualRevenueNet = roundMoney2(avgRev * 12);
    indicativeAnnualNetResult = roundMoney2(avgNet * 12);
  }

  const occProps = ctx.properties.filter((p) => report.properties.some((rp) => rp.id === p.id));
  const tu = occProps.reduce((s, p) => s + (p.total_units ?? 0), 0);
  const ou = occProps.reduce((s, p) => s + (p.occupied_units ?? 0), 0);
  const occupancyWeightedPct = tu > 0 ? roundMoney2((ou / tu) * 100) : null;

  const executive: ExecutiveKpis = {
    totalRevenueNet: totalRevNet,
    vatOnRevenue,
    totalRevenueGross: totalRevGross,
    totalCostsNet,
    vatOnCosts,
    totalCostsGross,
    netOperatingResult: totalNet,
    netMarginPct: totalRevNet > 0 ? roundMoney2((totalNet / totalRevNet) * 100) : null,
    avgMonthlyRevenueNet,
    indicativeAnnualRevenueNet,
    indicativeAnnualNetResult,
    occupancyWeightedPct,
    occupancyNote:
      occupancyWeightedPct != null
        ? `Snapshot occupancy ${ou}/${tu} units from property master data.`
        : "Occupancy not available.",
    revenueNetByMonth: report.portfolioByMonth.map((r) => ({
      monthKey: r.monthKey,
      net: r.revenue.total,
      basis: basisForMonth(r.monthKey, asOf),
    })),
    netResultByMonth: report.portfolioByMonth.map((r) => ({
      monthKey: r.monthKey,
      net: r.netIncome,
      basis: basisForMonth(r.monthKey, asOf),
    })),
  };

  const dataSources: DataSourceAttribution[] = [
    {
      id: "revenue",
      label: "Revenue (same engine as rent roll)",
      detail: "Leases, confirmed bookings, additional_services.",
      basisActualVsForecast: "Month-level actual vs forecast as for rent roll; see that report for lineage.",
      lastRelevantUpdate: asOf.toISOString(),
    },
    {
      id: "costs",
      label: "Operating costs",
      detail: "property_cost_entries by period_month; scheduled vs confirmed.",
      basisActualVsForecast: "Confirmed = actual recorded; scheduled = recurring template forecast.",
      lastRelevantUpdate: asOf.toISOString(),
    },
  ];

  const aggRev = sumVatBreakdowns(monthlyRows.map((m) => m.revenue));
  const aggCost = sumVatBreakdowns(monthlyRows.map((m) => m.costs));

  const vatSummaryLines: VatSummaryLine[] = [
    {
      section: "Revenue (rolled)",
      category: "All revenue buckets (net / VAT / gross)",
      ratePct: 0,
      net: aggRev.net,
      vat: aggRev.vat,
      gross: aggRev.gross,
      rate: aggRev.rate,
      rateLabel: "Mixed rates — same mapping as rent roll",
    },
    {
      section: "Costs (rolled)",
      category: "Operating costs with 25.5% VAT model",
      ratePct: VAT_FINLAND_GENERAL * 100,
      net: aggCost.net,
      vat: aggCost.vat,
      gross: aggCost.gross,
      rate: VAT_FINLAND_GENERAL,
      rateLabel: "25.5%",
    },
  ];

  const netVatPositionIndicative = roundMoney2(aggRev.vat - aggCost.vat);

  return {
    meta,
    executive,
    dataSources,
    monthlyRows,
    vatSummaryLines,
    netVatPositionIndicative,
  };
}
