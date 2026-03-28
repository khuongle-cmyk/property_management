import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { NetIncomeReportModel } from "@/lib/reports/net-income-types";
import { NET_INCOME_COST_KEYS, NET_INCOME_COST_LABELS } from "@/lib/reports/net-income-cost-accounts";
import type { ProfessionalNetIncomePack } from "@/lib/reports/professional-types";
import { eurPdf, resolveLogoDataUrl } from "./jspdf-shared";

type DocWithTable = jsPDF & { lastAutoTable?: { finalY: number } };

export async function buildNetIncomePdf(
  report: NetIncomeReportModel,
  pack: ProfessionalNetIncomePack,
): Promise<Uint8Array> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  const logo = await resolveLogoDataUrl(pack.meta.logoUrl);
  if (logo) {
    try {
      doc.addImage(logo.dataUrl, logo.format, margin, y, 55, 7);
      y += 10;
    } catch {
      y += 2;
    }
  } else {
    y += 2;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(26, 58, 90);
  doc.text(pack.meta.reportTitle, margin, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.text(`${pack.meta.periodStart} → ${pack.meta.periodEnd}`, margin, y);
  y += 6;
  const propLine = pack.meta.propertyLines.map((p) => p.name).join(" · ") || "Portfolio";
  const splitProps = doc.splitTextToSize(propLine, pageW - 2 * margin);
  doc.text(splitProps, margin, y);
  y += splitProps.length * 5 + 4;

  if (pack.meta.generatedByEmail) {
    doc.setFontSize(9);
    doc.text(`Prepared for review · ${pack.meta.generatedByEmail}`, margin, y);
    y += 6;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(26, 58, 90);
  doc.text("Executive summary", margin, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  const ex = pack.executive;
  const lines = [
    `Revenue (ex-VAT): ${eurPdf(ex.totalRevenueNet)}`,
    `Costs (ex-VAT): ${eurPdf(ex.totalCostsNet ?? 0)}`,
    `Net operating (ex-VAT): ${eurPdf(ex.netOperatingResult ?? 0)}`,
    `Net margin: ${ex.netMarginPct != null ? `${ex.netMarginPct.toFixed(1)}%` : "—"}`,
    `Indicative annual net: ${ex.indicativeAnnualNetResult != null ? eurPdf(ex.indicativeAnnualNetResult) : "—"}`,
    `Occupancy: ${ex.occupancyWeightedPct != null ? `${ex.occupancyWeightedPct}%` : "—"}`,
  ];
  for (const line of lines) {
    doc.text(line, margin, y);
    y += 5;
  }
  y += 4;

  const showAdminFees = pack.monthlyRows.some((r) => r.administrationFeesExVat != null && r.administrationFeesExVat > 0);
  const monthHead = showAdminFees
    ? ["Month", "Basis", "Rev net", "Rev VAT", "Cost net", "Cost VAT", "NOI ex-VAT", "Admin fees", "Net after fees"]
    : ["Month", "Basis", "Rev net", "Rev VAT", "Cost net", "Cost VAT", "Net ex-VAT"];
  const monthBody = pack.monthlyRows.map((r) => {
    const base = [
      r.monthKey,
      r.basis,
      eurPdf(r.revenue.net),
      eurPdf(r.revenue.vat),
      eurPdf(r.costs.net),
      eurPdf(r.costs.vat),
      eurPdf(r.netOperatingExVat),
    ];
    if (showAdminFees) {
      base.push(
        eurPdf(r.administrationFeesExVat ?? 0),
        eurPdf(r.netAfterAdminFeesExVat ?? r.netOperatingExVat),
      );
    }
    return base;
  });

  autoTable(doc, {
    startY: y,
    head: [monthHead],
    body: monthBody,
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 58, 90], textColor: 255 },
    margin: { left: margin, right: margin },
    showHead: "everyPage",
  });

  y = (doc as DocWithTable).lastAutoTable?.finalY ?? y + 40;
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(26, 58, 90);
  doc.text("Cost breakdown (portfolio, period totals)", margin, y);
  y += 6;

  const costBody: string[][] = NET_INCOME_COST_KEYS.map((k) => {
    const total = report.portfolioByMonth.reduce((s, m) => s + (m.costs[k] ?? 0), 0);
    return [NET_INCOME_COST_LABELS[k].slice(0, 36), eurPdf(total)];
  });
  const periodCostTotal = report.portfolioByMonth.reduce((s, m) => s + m.costs.total, 0);
  costBody.push(["Total (as rolled in report)", eurPdf(periodCostTotal)]);

  autoTable(doc, {
    startY: y,
    head: [["Category", "Amount (EUR)"]],
    body: costBody,
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 58, 90], textColor: 255 },
    margin: { left: margin, right: margin },
    showHead: "everyPage",
  });

  y = (doc as DocWithTable).lastAutoTable?.finalY ?? y + 40;
  y += 8;

  if (y > 250) {
    doc.addPage();
    y = margin;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  doc.text(`Indicative VAT position (output − input): ${eurPdf(pack.netVatPositionIndicative)}`, margin, y);
  y += 6;
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Not tax advice. Finnish VAT rates modeled for presentation only.", margin, y);
  y += 8;

  doc.setFontSize(9);
  doc.setTextColor(13, 61, 59);
  const foot = `${pack.meta.brandName} · Confidential · generated ${pack.meta.generatedAtIso.slice(0, 10)}`;
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${foot} · Page ${i} / ${totalPages}`, margin, doc.internal.pageSize.getHeight() - 10);
  }

  const buf = doc.output("arraybuffer");
  return new Uint8Array(buf);
}
