import type { RentRollReportModel } from "./rent-roll-types";
import type {
  DataBasis,
  DataSourceAttribution,
  ExecutiveKpis,
  MonthlyRevenueVatRow,
  ProfessionalRentRollPack,
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

function buildMeta(
  report: RentRollReportModel,
  ctx: ReportExportContext,
  asOf: Date,
): ProfessionalReportMeta {
  const propertyLines = ctx.properties
    .filter((p) => report.properties.some((rp) => rp.id === p.id))
    .map((p) => ({
      id: p.id,
      name: p.name ?? "—",
      addressLine: formatPropertyAddress(p),
    }));

  const missingInvoices =
    report.sections.officeRents && report.officeRentRoll.some((o) => o.invoicedTotal == null);
  const dataQualityNotes: string[] = [];
  if (missingInvoices) {
    dataQualityNotes.push(
      "Some office lines have no matching lease invoice for that month — contractual rent is shown; verify billed vs booked.",
    );
  }
  if (report.vacancyForecast.length > 0) {
    dataQualityNotes.push(
      "Vacancy forecast uses list prices from space records where no active lease exists — indicative only.",
    );
  }

  const assumptions = [
    "Amounts in the operational ledger are modeled as ex-VAT (net). Gross and VAT columns are derived using Finnish reference rates (standard 25.5%; booking revenue 10% reduced-rate treatment — confirm tax classification with your adviser).",
    "This report is management information only and not statutory financial statements.",
    "Confirmed bookings only are included in meeting / desk / venue revenue.",
    "Rounding to two decimals may cause minor tie-out differences.",
  ];

  return {
    brandName: ctx.brandName,
    logoUrl: ctx.logoUrl,
    coverImageUrl: ctx.coverImageUrl,
    reportTitle: "Rent roll & revenue forecast",
    reportKind: "rent_roll",
    periodStart: report.startDate,
    periodEnd: report.endDate,
    monthCount: report.monthKeys.length,
    generatedAtIso: asOf.toISOString(),
    generatedByEmail: ctx.generatedByEmail,
    generatedByUserId: ctx.generatedByUserId,
    propertyLines: propertyLines.length ? propertyLines : report.properties.map((p) => ({ id: p.id, name: p.name, addressLine: p.city ?? "" })),
    dataQualityNotes,
    assumptions,
  };
}

function buildExecutive(report: RentRollReportModel, monthlyVat: MonthlyRevenueVatRow[], ctx: ReportExportContext): ExecutiveKpis {
  const totalRevenueNet = roundMoney2(report.monthlySummary.reduce((s, r) => s + r.total, 0));
  const vatOnRevenue = roundMoney2(monthlyVat.reduce((s, r) => s + r.total.vat, 0));
  const totalRevenueGross = roundMoney2(monthlyVat.reduce((s, r) => s + r.total.gross, 0));
  const n = report.monthKeys.length || 1;
  const avgMonthlyRevenueNet = roundMoney2(totalRevenueNet / n);

  let indicativeAnnualRevenueNet: number | null = null;
  const last3 = report.monthlySummary.slice(-3);
  if (last3.length >= 1) {
    const run = roundMoney2(last3.reduce((s, r) => s + r.total, 0) / last3.length);
    indicativeAnnualRevenueNet = roundMoney2(run * 12);
  }

  const occProps = ctx.properties.filter((p) => report.properties.some((rp) => rp.id === p.id));
  const tu = occProps.reduce((s, p) => s + (p.total_units ?? 0), 0);
  const ou = occProps.reduce((s, p) => s + (p.occupied_units ?? 0), 0);
  const occupancyWeightedPct = tu > 0 ? roundMoney2((ou / tu) * 100) : null;

  const revenueNetByMonth = report.monthlySummary.map((r) => ({
    monthKey: r.monthKey,
    net: r.total,
    basis: basisForMonth(r.monthKey, new Date()),
  }));

  return {
    totalRevenueNet,
    vatOnRevenue,
    totalRevenueGross,
    avgMonthlyRevenueNet,
    indicativeAnnualRevenueNet,
    occupancyWeightedPct,
    occupancyNote:
      occupancyWeightedPct != null
        ? `Snapshot from property records (total ${ou}/${tu} units). Not time-series occupancy.`
        : "Occupancy not available from property totals.",
    revenueNetByMonth,
  };
}

function buildDataSources(report: RentRollReportModel, asOf: Date): DataSourceAttribution[] {
  const ts = asOf.toISOString();
  return [
    {
      id: "leases",
      label: "Office rent (contract)",
      detail: "Summed from active room contracts and room_contract_items per calendar month.",
      basisActualVsForecast:
        "Completed calendar months treated as contractual actuals; future months as forecast from lease terms.",
      lastRelevantUpdate: ts,
    },
    {
      id: "bookings",
      label: "Meeting / desk / venue",
      detail: "Confirmed bookings only; total_price by booking start month (UTC).",
      basisActualVsForecast: "Completed months: realized; future-dated bookings: forecast.",
      lastRelevantUpdate: ts,
    },
    {
      id: "additional_services",
      label: "Additional services",
      detail: "lease-linked additional_services lines billed per billing_month.",
      basisActualVsForecast: "Accrual by billing month; verify against invoicing.",
      lastRelevantUpdate: ts,
    },
    {
      id: "lease_invoices",
      label: "Lease invoices (cross-check)",
      detail: "Invoiced base / totals shown on office lines when a lease_invoices row exists.",
      basisActualVsForecast: "Derived from lease_invoices table.",
      lastRelevantUpdate: ts,
    },
  ].filter(() => true);
}

export function buildProfessionalRentRollPack(report: RentRollReportModel, ctx: ReportExportContext): ProfessionalRentRollPack {
  const asOf = new Date();

  const monthlyRevenueVat: MonthlyRevenueVatRow[] = report.monthlySummary.map((r) => {
    const office = vatFromNet(r.officeContractRent, VAT_FINLAND_GENERAL, "25.5% standard");
    const meeting = vatFromNet(r.meetingRoomBookings, VAT_FINLAND_REDUCED_SERVICES, "10% reduced (bookings)");
    const hotDesk = vatFromNet(r.hotDeskBookings, VAT_FINLAND_REDUCED_SERVICES, "10% reduced (bookings)");
    const venue = vatFromNet(r.venueBookings, VAT_FINLAND_REDUCED_SERVICES, "10% reduced (bookings)");
    const additionalServices = vatFromNet(r.additionalServices, VAT_FINLAND_GENERAL, "25.5% standard");
    const total = sumVatBreakdowns([office, meeting, hotDesk, venue, additionalServices]);
    return {
      monthKey: r.monthKey,
      basis: basisForMonth(r.monthKey, asOf),
      office,
      meeting,
      hotDesk,
      venue,
      additionalServices,
      total,
    };
  });

  const meta = buildMeta(report, ctx, asOf);
  const executive = buildExecutive(report, monthlyRevenueVat, ctx);
  const dataSources = buildDataSources(report, asOf);

  const sumOffice = sumVatBreakdowns(monthlyRevenueVat.map((m) => m.office));
  const sumMeet = sumVatBreakdowns(monthlyRevenueVat.map((m) => m.meeting));
  const sumHd = sumVatBreakdowns(monthlyRevenueVat.map((m) => m.hotDesk));
  const sumVen = sumVatBreakdowns(monthlyRevenueVat.map((m) => m.venue));
  const sumAdd = sumVatBreakdowns(monthlyRevenueVat.map((m) => m.additionalServices));

  const vatSummaryLines: VatSummaryLine[] = [
    { section: "Revenue", category: "Office contracts", ratePct: VAT_FINLAND_GENERAL * 100, ...sumOffice },
    { section: "Revenue", category: "Meeting bookings (reduced model)", ratePct: VAT_FINLAND_REDUCED_SERVICES * 100, ...sumMeet },
    { section: "Revenue", category: "Hot desk bookings (reduced model)", ratePct: VAT_FINLAND_REDUCED_SERVICES * 100, ...sumHd },
    { section: "Revenue", category: "Venue bookings (reduced model)", ratePct: VAT_FINLAND_REDUCED_SERVICES * 100, ...sumVen },
    { section: "Revenue", category: "Additional services", ratePct: VAT_FINLAND_GENERAL * 100, ...sumAdd },
  ];

  const totalOutVat = roundMoney2(vatSummaryLines.reduce((s, l) => s + l.vat, 0));

  return {
    meta,
    executive,
    dataSources,
    monthlyRevenueVat,
    vatSummaryLines,
    netVatPositionIndicative: totalOutVat,
  };
}
