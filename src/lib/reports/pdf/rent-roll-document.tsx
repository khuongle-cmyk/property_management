import React from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { RentRollReportModel } from "@/lib/reports/rent-roll-types";
import type { ProfessionalRentRollPack } from "@/lib/reports/professional-types";

const COL_HEADER = "#1e3a5f";
const COL_ACCENT = "#0d9488";
const COL_MUTED = "#64748b";

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingHorizontal: 36, paddingBottom: 48, fontSize: 8.5, fontFamily: "Helvetica", color: "#0f172a" },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 8, color: COL_MUTED, borderTopWidth: 1, borderTopColor: "#e2e8f0", paddingTop: 6 },
  h1: { fontSize: 20, color: COL_HEADER, marginBottom: 6, fontFamily: "Helvetica", fontWeight: "bold" },
  h2: { fontSize: 13, color: COL_HEADER, marginTop: 12, marginBottom: 8, fontFamily: "Helvetica", fontWeight: "bold" },
  sub: { fontSize: 10, color: COL_MUTED, marginBottom: 10 },
  coverBand: { height: 4, backgroundColor: COL_ACCENT, marginHorizontal: -36, marginTop: -36, marginBottom: 20 },
  coverImg: { height: 110, objectFit: "cover", marginHorizontal: -36, marginBottom: 14 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  kpiBox: { width: "48%", borderWidth: 1, borderColor: "#e2e8f0", padding: 10, borderRadius: 4, backgroundColor: "#f8fafc" },
  kpiLabel: { fontSize: 8, color: COL_MUTED, marginBottom: 4 },
  kpiVal: { fontSize: 12, fontFamily: "Helvetica-Bold", color: COL_HEADER },
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  barLabel: { width: 56, fontSize: 7 },
  barTrack: { flexGrow: 1, height: 8, backgroundColor: "#e2e8f0", borderRadius: 2 },
  barFill: { height: 8, backgroundColor: COL_ACCENT, borderRadius: 2 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: COL_HEADER,
    color: "#fff",
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontFamily: "Helvetica",
    fontWeight: "bold",
  },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9", paddingVertical: 4, paddingHorizontal: 4 },
  cellSm: { width: "14%", fontSize: 7.5 },
  cellNum: { width: "11%", fontSize: 7.5, textAlign: "right" },
  tocItem: { fontSize: 9, marginBottom: 5, color: "#334155" },
});

function eur(n: number): string {
  return new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);
}

function Sparkline({ data }: { data: { monthKey: string; net: number }[] }) {
  const max = Math.max(...data.map((d) => d.net), 1);
  const slice = data.slice(-12);
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ fontSize: 8, color: COL_MUTED, marginBottom: 4 }}>Revenue (ex-VAT) — last {slice.length} months</Text>
      {slice.map((d) => (
        <View key={d.monthKey} style={styles.barRow} wrap={false}>
          <Text style={styles.barLabel}>{d.monthKey}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.min(100, (d.net / max) * 100)}%` }]} />
          </View>
          <Text style={{ width: 70, fontSize: 7, textAlign: "right" }}>{eur(d.net)}</Text>
        </View>
      ))}
    </View>
  );
}

export function RentRollProfessionalDocument({
  report,
  pack,
}: {
  report: RentRollReportModel;
  pack: ProfessionalRentRollPack;
}) {
  const m = pack.meta;
  const ex = pack.executive;
  const monthlySlice = pack.monthlyRevenueVat.slice(0, 18);

  return (
    <Document
      title={`${m.reportTitle} — ${m.periodStart}`}
      author={m.brandName}
      subject={`Period ${m.periodStart} to ${m.periodEnd}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.coverBand} fixed />
        {m.coverImageUrl ? <Image src={m.coverImageUrl} style={styles.coverImg} /> : null}
        {m.logoUrl ? (
          <Image
            src={m.logoUrl}
            style={{ width: 120, height: 40, objectFit: "contain", marginBottom: 12 }}
          />
        ) : null}
        <Text style={styles.h1}>{m.reportTitle}</Text>
        <Text style={styles.sub}>
          {m.propertyLines.map((p) => p.name).join(" · ") || "Portfolio"} — {m.periodStart} → {m.periodEnd}
        </Text>
        <Text style={styles.sub}>{m.propertyLines.map((p) => p.addressLine).join(" | ")}</Text>
        <Text style={{ fontSize: 9, marginTop: 6 }}>
          Generated {new Date(m.generatedAtIso).toUTCString().slice(0, 16)} UTC
          {m.generatedByEmail ? ` · ${m.generatedByEmail}` : ""}
        </Text>
        <Text style={styles.h2}>Executive summary</Text>
        <View style={styles.kpiGrid}>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Revenue (ex-VAT)</Text>
            <Text style={styles.kpiVal}>{eur(ex.totalRevenueNet)}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>VAT on revenue (indicative)</Text>
            <Text style={styles.kpiVal}>{eur(ex.vatOnRevenue)}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Revenue (incl. VAT)</Text>
            <Text style={styles.kpiVal}>{eur(ex.totalRevenueGross)}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Annual run-rate (indicative)</Text>
            <Text style={styles.kpiVal}>{ex.indicativeAnnualRevenueNet != null ? eur(ex.indicativeAnnualRevenueNet) : "—"}</Text>
          </View>
          <View style={styles.kpiBox}>
            <Text style={styles.kpiLabel}>Occupancy (snapshot)</Text>
            <Text style={styles.kpiVal}>{ex.occupancyWeightedPct != null ? `${ex.occupancyWeightedPct}%` : "—"}</Text>
          </View>
        </View>
        <Sparkline data={ex.revenueNetByMonth} />
        <Text style={[styles.footer, { textAlign: "center" }]} render={({ pageNumber, totalPages }) => `${m.brandName} · Confidential · ${pageNumber} / ${totalPages}`} fixed />
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.h2}>Table of contents</Text>
        <Text style={styles.tocItem}>1. Executive summary (cover)</Text>
        <Text style={styles.tocItem}>2. Monthly revenue — ex-VAT, VAT, gross</Text>
        <Text style={styles.tocItem}>3. VAT summary &amp; data sources</Text>
        <Text style={styles.tocItem}>4. Assumptions &amp; data quality</Text>
        <Text style={styles.h2}>Monthly revenue (first {monthlySlice.length} rows)</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.cellSm, { width: "12%" }]}>Month</Text>
          <Text style={[styles.cellSm, { width: "10%" }]}>Basis</Text>
          <Text style={styles.cellNum}>Net</Text>
          <Text style={styles.cellNum}>VAT</Text>
          <Text style={styles.cellNum}>Gross</Text>
        </View>
        {monthlyMonthRows(monthlySlice)}
        <Text style={{ fontSize: 8, color: COL_MUTED, marginTop: 8 }}>Full detail in professional Excel export.</Text>
        <Text style={[styles.footer, { textAlign: "center" }]} render={({ pageNumber, totalPages }) => `${m.brandName} · Confidential · ${pageNumber} / ${totalPages}`} fixed />
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.h2}>VAT summary (Finland — indicative)</Text>
        <View style={styles.tableHeader}>
          <Text style={{ width: "22%", color: "#fff", fontSize: 8 }}>Section</Text>
          <Text style={{ width: "28%", color: "#fff", fontSize: 8 }}>Category</Text>
          <Text style={styles.cellNum}>Rate</Text>
          <Text style={styles.cellNum}>Net</Text>
          <Text style={styles.cellNum}>VAT</Text>
          <Text style={styles.cellNum}>Gross</Text>
        </View>
        {pack.vatSummaryLines.map((l, i) => (
          <View key={i} style={styles.tableRow}>
            <Text style={{ width: "22%", fontSize: 8 }}>{l.section}</Text>
            <Text style={{ width: "28%", fontSize: 8 }}>{l.category}</Text>
            <Text style={styles.cellNum}>{(l.ratePct || l.rate * 100).toFixed(1)}%</Text>
            <Text style={styles.cellNum}>{eur(l.net)}</Text>
            <Text style={styles.cellNum}>{eur(l.vat)}</Text>
            <Text style={styles.cellNum}>{eur(l.gross)}</Text>
          </View>
        ))}
        <Text style={{ marginTop: 10, fontSize: 9 }}>Indicative output VAT (revenue): {eur(pack.netVatPositionIndicative)}</Text>
        <Text style={styles.h2}>Data sources</Text>
        {pack.dataSources.map((d) => (
          <View key={d.id} style={{ marginBottom: 8 }} wrap={false}>
            <Text style={{ fontFamily: "Helvetica", fontWeight: "bold", fontSize: 9 }}>{d.label}</Text>
            <Text style={{ fontSize: 8, color: COL_MUTED }}>{d.detail}</Text>
            <Text style={{ fontSize: 8 }}>{d.basisActualVsForecast}</Text>
          </View>
        ))}
        <Text style={[styles.footer, { textAlign: "center" }]} render={({ pageNumber, totalPages }) => `${m.brandName} · Confidential · ${pageNumber} / ${totalPages}`} fixed />
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.h2}>Assumptions &amp; data quality</Text>
        {m.assumptions.map((a, i) => (
          <Text key={i} style={{ marginBottom: 6, fontSize: 9 }}>
            • {a}
          </Text>
        ))}
        {m.dataQualityNotes.length ? <Text style={styles.h2}>Missing / caveats</Text> : null}
        {m.dataQualityNotes.map((n, i) => (
          <Text key={i} style={{ marginBottom: 6, fontSize: 9, color: "#b45309" }}>
            • {n}
          </Text>
        ))}
        <Text style={[styles.footer, { textAlign: "center" }]} render={({ pageNumber, totalPages }) => `${m.brandName} · Confidential · ${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}

function monthlyMonthRows(rows: ProfessionalRentRollPack["monthlyRevenueVat"]) {
  return rows.map((r) => (
    <View key={r.monthKey} style={styles.tableRow} wrap={false}>
      <Text style={[styles.cellSm, { width: "12%" }]}>{r.monthKey}</Text>
      <Text style={[styles.cellSm, { width: "10%" }]}>{r.basis}</Text>
      <Text style={styles.cellNum}>{eur(r.total.net)}</Text>
      <Text style={styles.cellNum}>{eur(r.total.vat)}</Text>
      <Text style={styles.cellNum}>{eur(r.total.gross)}</Text>
    </View>
  ));
}
