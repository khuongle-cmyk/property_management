import React from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { NetIncomeReportModel } from "@/lib/reports/net-income-types";
import type { ProfessionalNetIncomePack } from "@/lib/reports/professional-types";

const COL_HEADER = "#1e3a8a";
const COL_POS = "#0d9488";
const COL_NEG = "#dc2626";
const COL_MUTED = "#64748b";

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingHorizontal: 36, paddingBottom: 48, fontSize: 8.5, fontFamily: "Helvetica", color: "#0f172a" },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 8, color: COL_MUTED, borderTopWidth: 1, borderTopColor: "#e2e8f0", paddingTop: 6, textAlign: "center" },
  h1: { fontSize: 20, color: COL_HEADER, marginBottom: 6, fontFamily: "Helvetica", fontWeight: "bold" },
  h2: { fontSize: 13, color: COL_HEADER, marginTop: 10, marginBottom: 8, fontFamily: "Helvetica", fontWeight: "bold" },
  sub: { fontSize: 9, color: COL_MUTED, marginBottom: 6 },
  coverBand: { height: 4, backgroundColor: COL_POS, marginHorizontal: -36, marginTop: -36, marginBottom: 20 },
  coverImg: { height: 110, objectFit: "cover", marginHorizontal: -36, marginBottom: 12 },
  kpiBox: { width: "48%", borderWidth: 1, borderColor: "#e2e8f0", padding: 10, marginBottom: 8, backgroundColor: "#f8fafc" },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  kpiLabel: { fontSize: 8, color: COL_MUTED },
  kpiVal: { fontSize: 11, fontFamily: "Helvetica", fontWeight: "bold" },
  row: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  th: {
    flexDirection: "row",
    backgroundColor: COL_HEADER,
    color: "#fff",
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontFamily: "Helvetica",
    fontWeight: "bold",
  },
  cell: { width: "16%", fontSize: 7.5 },
  cellR: { width: "14%", fontSize: 7.5, textAlign: "right" },
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 3 },
  barTrack: { flexGrow: 1, height: 7, backgroundColor: "#e2e8f0", borderRadius: 2 },
  barFillPos: { height: 7, backgroundColor: COL_POS, borderRadius: 2 },
  barFillNeg: { height: 7, backgroundColor: COL_NEG, borderRadius: 2 },
});

function eur(n: number): string {
  return new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);
}

export function NetIncomeProfessionalDocument({
  report,
  pack,
}: {
  report: NetIncomeReportModel;
  pack: ProfessionalNetIncomePack;
}) {
  const m = pack.meta;
  const ex = pack.executive;
  const maxAbsNet = Math.max(...report.portfolioByMonth.map((x) => Math.abs(x.netIncome)), 1);

  return (
    <Document title={`${m.reportTitle}`} author={m.brandName}>
      <Page size="A4" style={styles.page}>
        <View style={styles.coverBand} fixed />
        {m.coverImageUrl ? <Image src={m.coverImageUrl} style={styles.coverImg} /> : null}
        {m.logoUrl ? <Image src={m.logoUrl} style={{ width: 110, height: 36, objectFit: "contain", marginBottom: 10 }} /> : null}
        <Text style={styles.h1}>{m.reportTitle}</Text>
        <Text style={styles.sub}>
          {m.periodStart} → {m.periodEnd} · {m.propertyLines.map((p) => p.name).join(" · ")}
        </Text>
        <Text style={styles.sub}>{m.generatedByEmail ? `Prepared for review · ${m.generatedByEmail}` : m.generatedByUserId}</Text>
        <Text style={styles.h2}>Executive summary</Text>
        <View style={styles.kpiGrid}>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Revenue (ex-VAT)</Text>
            <Text style={styles.kpiVal}>{eur(ex.totalRevenueNet)}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Costs (ex-VAT)</Text>
            <Text style={styles.kpiVal}>{eur(ex.totalCostsNet ?? 0)}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Net operating (ex-VAT)</Text>
            <Text style={[styles.kpiVal, { color: (ex.netOperatingResult ?? 0) >= 0 ? COL_POS : COL_NEG }]}>
              {eur(ex.netOperatingResult ?? 0)}
            </Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Net margin</Text>
            <Text style={styles.kpiVal}>{ex.netMarginPct != null ? `${ex.netMarginPct.toFixed(1)}%` : "—"}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>12m net (indicative run-rate)</Text>
            <Text style={styles.kpiVal}>{ex.indicativeAnnualNetResult != null ? eur(ex.indicativeAnnualNetResult) : "—"}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Occupancy snapshot</Text>
            <Text style={styles.kpiVal}>{ex.occupancyWeightedPct != null ? `${ex.occupancyWeightedPct}%` : "—"}</Text>
          </View>
        </View>
        <Text style={styles.h2}>Profitability trend (ex-VAT)</Text>
        {report.portfolioByMonth.slice(-12).map((pm) => (
          <View key={pm.monthKey} style={styles.barRow} wrap={false}>
            <Text style={{ width: 50, fontSize: 7 }}>{pm.monthKey}</Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  pm.netIncome >= 0 ? styles.barFillPos : styles.barFillNeg,
                  { width: `${Math.min(100, (Math.abs(pm.netIncome) / maxAbsNet) * 100)}%` },
                ]}
              />
            </View>
            <Text style={{ width: 72, fontSize: 7, textAlign: "right" }}>{eur(pm.netIncome)}</Text>
          </View>
        ))}
        <Text style={styles.footer} render={({ pageNumber, totalPages }) => `${m.brandName} · Confidential · ${pageNumber} / ${totalPages}`} fixed />
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.h2}>Monthly P&amp;L (ex-VAT / VAT / gross)</Text>
        <View style={styles.th}>
          <Text style={styles.cell}>Month</Text>
          <Text style={styles.cell}>Basis</Text>
          <Text style={styles.cellR}>Rev net</Text>
          <Text style={styles.cellR}>Rev VAT</Text>
          <Text style={styles.cellR}>Cost net</Text>
          <Text style={styles.cellR}>Cost VAT</Text>
          <Text style={styles.cellR}>Net ex-VAT</Text>
        </View>
        {pack.monthlyRows.slice(0, 20).map((r) => (
          <View key={r.monthKey} style={styles.row} wrap={false}>
            <Text style={styles.cell}>{r.monthKey}</Text>
            <Text style={styles.cell}>{r.basis}</Text>
            <Text style={styles.cellR}>{eur(r.revenue.net)}</Text>
            <Text style={styles.cellR}>{eur(r.revenue.vat)}</Text>
            <Text style={styles.cellR}>{eur(r.costs.net)}</Text>
            <Text style={styles.cellR}>{eur(r.costs.vat)}</Text>
            <Text style={[styles.cellR, { color: r.netOperatingExVat >= 0 ? COL_POS : COL_NEG }]}>{eur(r.netOperatingExVat)}</Text>
          </View>
        ))}
        <Text style={styles.h2}>Indicative VAT position</Text>
        <Text style={{ fontSize: 9 }}>Output VAT (revenue) − input VAT (costs) = {eur(pack.netVatPositionIndicative)}</Text>
        <Text style={{ fontSize: 8, color: COL_MUTED, marginTop: 6 }}>Not tax advice. Use Excel workbook for tie-out.</Text>
        <Text style={styles.footer} render={({ pageNumber, totalPages }) => `${m.brandName} · Confidential · ${pageNumber} / ${totalPages}`} fixed />
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.h2}>Data sources &amp; quality</Text>
        {pack.dataSources.map((d) => (
          <View key={d.id} style={{ marginBottom: 8 }}>
            <Text style={{ fontFamily: "Helvetica", fontWeight: "bold", fontSize: 9 }}>{d.label}</Text>
            <Text style={{ fontSize: 8, color: COL_MUTED }}>{d.detail}</Text>
          </View>
        ))}
        {m.dataQualityNotes.map((n, i) => (
          <Text key={i} style={{ color: "#b45309", marginBottom: 4 }}>
            • {n}
          </Text>
        ))}
        <Text style={styles.h2}>Assumptions</Text>
        {m.assumptions.map((a, i) => (
          <Text key={i} style={{ marginBottom: 5 }}>
            • {a}
          </Text>
        ))}
        <Text style={styles.footer} render={({ pageNumber, totalPages }) => `${m.brandName} · Confidential · ${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
