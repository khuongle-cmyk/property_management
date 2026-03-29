"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import type { NetIncomeReportModel } from "@/lib/reports/net-income-types";
import { REPORT_READER_ROLES } from "@/lib/reports/report-access";
import { NET_INCOME_COST_KEYS, NET_INCOME_COST_LABELS } from "@/lib/reports/net-income-cost-accounts";
import {
  SIMPLIFIED_COST_COLUMN_KEYS,
  SIMPLIFIED_COST_HEADERS,
  simplifiedPortfolioCostsFromBreakdown,
} from "@/lib/reports/net-income-simplified-cost-columns";
import { loadScopedPropertiesForUser } from "@/lib/properties/scoped";
import { AdminFeeSettingsPanel } from "@/components/reports/AdminFeeSettingsPanel";

type PropertyRow = { id: string; name: string; city: string | null; tenant_id: string };
type MembershipRow = { tenant_id: string | null; role: string | null };

function finiteNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(n: unknown): string {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(finiteNum(n));
}

function moneyColored(n: unknown) {
  const v = finiteNum(n);
  return <span style={{ color: v < 0 ? "#c62828" : undefined }}>{money(v)}</span>;
}

function pct(n: number | null): string {
  if (n === null) return "—";
  return `${finiteNum(n).toFixed(1)}%`;
}

function defaultRange(): { start: string; end: string } {
  const y = new Date().getUTCFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

function NetIncomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prePropertyId = (searchParams.get("propertyId") ?? "").trim();

  const [loadingMeta, setLoadingMeta] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [allProperties, setAllProperties] = useState(true);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [range, setRange] = useState(defaultRange);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [report, setReport] = useState<NetIncomeReportModel | null>(null);
  const [proExport, setProExport] = useState<null | "pdf" | "excel">(null);
  const [includeAdministration, setIncludeAdministration] = useState(false);
  const [allocateAdminByRevenue, setAllocateAdminByRevenue] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: mem } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id);
      if (cancelled) return;
      const roles = (mem ?? []).map((m: MembershipRow) => (m.role ?? "").toLowerCase());
      if (!roles.some((r: string) => REPORT_READER_ROLES.has(r))) {
        setForbidden(true);
        setLoadingMeta(false);
        return;
      }
      const scoped = await loadScopedPropertiesForUser(supabase, user.id);
      const plist = (scoped.properties as PropertyRow[]) ?? [];
      setIsSuperAdmin(scoped.isSuperAdmin);
      setProperties(plist);
      if (prePropertyId && plist.some((p) => p.id === prePropertyId)) {
        setAllProperties(false);
        setSelectedPropertyIds([prePropertyId]);
      }
      setLoadingMeta(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, prePropertyId]);

  const body = useMemo(
    () => ({
      propertyIds: allProperties ? null : selectedPropertyIds,
      startDate: range.start,
      endDate: range.end,
      includeAdministration,
      allocateAdminByRevenue: includeAdministration && allocateAdminByRevenue,
    }),
    [allProperties, selectedPropertyIds, range, includeAdministration, allocateAdminByRevenue],
  );

  /** Per-property / detail tables: show admin fee breakdown when any row has fees. */
  const hasAdminFees = useMemo(() => {
    if (!report) return false;
    return report.rows.some(
      (r) => (r.administrationFeesTotal ?? 0) > 0 || (r.platformManagementFee ?? 0) > 0,
    );
  }, [report]);

  const portfolioAdminFeeLines = useMemo(() => {
    if (!report) {
      return new Map<
        string,
        { settingId: string; reportPrimary: string; reportSubtext?: string; amount: number }[]
      >();
    }
    const byMonth = new Map<
      string,
      Map<string, { reportPrimary: string; reportSubtext?: string; amount: number }>
    >();
    for (const r of report.rows) {
      if (!byMonth.has(r.monthKey)) byMonth.set(r.monthKey, new Map());
      const m = byMonth.get(r.monthKey)!;
      for (const line of r.administrationFees ?? []) {
        const prev = m.get(line.settingId);
        const primary = line.reportPrimary ?? line.name;
        const sub = line.reportSubtext ?? prev?.reportSubtext;
        m.set(line.settingId, {
          reportPrimary: primary,
          reportSubtext: sub,
          amount: (prev?.amount ?? 0) + line.amount,
        });
      }
    }
    const out = new Map<string, { settingId: string; reportPrimary: string; reportSubtext?: string; amount: number }[]>();
    for (const [mk, agg] of byMonth) {
      out.set(
        mk,
        [...agg.entries()].map(([settingId, v]) => ({ settingId, ...v })),
      );
    }
    return out;
  }, [report]);

  const portfolioSimplifiedCostTable = useMemo(() => {
    const zeroTotals: ReturnType<typeof simplifiedPortfolioCostsFromBreakdown> = {
      rent: 0,
      staff: 0,
      subcontracting: 0,
      premises: 0,
      cleaning: 0,
      utilities: 0,
      marketing: 0,
      admin: 0,
      other: 0,
      total: 0,
    };
    if (!report) {
      return { rows: [] as ({ monthKey: string } & ReturnType<typeof simplifiedPortfolioCostsFromBreakdown>)[], totals: zeroTotals };
    }
    const rows = report.portfolioByMonth.map((pm) => ({
      monthKey: pm.monthKey,
      ...simplifiedPortfolioCostsFromBreakdown(pm.costs),
    }));
    const totals = { ...zeroTotals };
    for (const r of rows) {
      for (const k of SIMPLIFIED_COST_COLUMN_KEYS) {
        totals[k] += r[k];
      }
      totals.total += r.total;
    }
    return { rows, totals };
  }, [report]);

  const portfolioByMonthTotals = useMemo(() => {
    if (!report || report.portfolioByMonth.length === 0) {
      return {
        revenue: 0,
        costs: 0,
        noi: 0,
        marginPct: null as number | null,
        administrationFees: 0,
        netAfterFees: 0,
        marginAfterFeesPct: null as number | null,
      };
    }
    let revenue = 0;
    let costs = 0;
    let noi = 0;
    let administrationFees = 0;
    let netAfterFees = 0;
    for (const r of report.portfolioByMonth) {
      revenue += r.revenue.total;
      costs += r.costs.total;
      noi += r.netIncome;
      administrationFees += (r.administrationFeesTotal ?? 0) + (r.platformManagementFee ?? 0);
      netAfterFees += r.netIncomeAfterPlatformFee ?? r.netIncomeAfterAdminFees ?? r.netIncome;
    }
    return {
      revenue,
      costs,
      noi,
      marginPct: revenue > 0 ? (noi / revenue) * 100 : null,
      administrationFees,
      netAfterFees,
      marginAfterFeesPct: revenue > 0 ? (netAfterFees / revenue) * 100 : null,
    };
  }, [report]);

  const revenueDetailTotals = useMemo(() => {
    if (!report || report.portfolioByMonth.length === 0) {
      return {
        office: 0,
        meeting: 0,
        hotDesk: 0,
        venue: 0,
        virtualOffice: 0,
        furniture: 0,
        additionalServices: 0,
        total: 0,
      };
    }
    let office = 0;
    let meeting = 0;
    let hotDesk = 0;
    let venue = 0;
    let virtualOffice = 0;
    let furniture = 0;
    let additionalServices = 0;
    let total = 0;
    for (const r of report.portfolioByMonth) {
      office += r.revenue.office;
      meeting += r.revenue.meeting;
      hotDesk += r.revenue.hotDesk;
      venue += r.revenue.venue;
      virtualOffice += r.revenue.virtualOffice;
      furniture += r.revenue.furniture;
      additionalServices += r.revenue.additionalServices;
      total += r.revenue.total;
    }
    return { office, meeting, hotDesk, venue, virtualOffice, furniture, additionalServices, total };
  }, [report]);

  const hasAllocatedAdminCol = useMemo(
    () => !!report?.rows.some((x) => x.allocatedAdministrationCost != null),
    [report],
  );

  const perPropertyTotals = useMemo(() => {
    if (!report || report.rows.length === 0) {
      return {
        revenue: 0,
        costs: 0,
        noi: 0,
        marginPct: null as number | null,
        allocatedAdmin: 0,
        netAfterAdminAlloc: 0,
        administrationFees: 0,
        netAfterFees: 0,
        marginAfterFeesPct: null as number | null,
        scheduled: 0,
        confirmed: 0,
      };
    }
    let revenue = 0;
    let costs = 0;
    let noi = 0;
    let allocatedAdmin = 0;
    let netAfterAdminAlloc = 0;
    let administrationFees = 0;
    let netAfterFees = 0;
    let scheduled = 0;
    let confirmed = 0;
    for (const r of report.rows) {
      revenue += r.revenue.total;
      costs += r.costs.total;
      noi += r.netIncome;
      allocatedAdmin += r.allocatedAdministrationCost ?? 0;
      netAfterAdminAlloc += r.netIncomeAfterAdminAllocation ?? r.netIncome;
      administrationFees += (r.administrationFeesTotal ?? 0) + (r.platformManagementFee ?? 0);
      netAfterFees += r.netIncomeAfterPlatformFee ?? r.netIncomeAfterAdminFees ?? r.netIncome;
      scheduled += r.costsScheduled;
      confirmed += r.costsConfirmed;
    }
    return {
      revenue,
      costs,
      noi,
      marginPct: revenue > 0 ? (noi / revenue) * 100 : null,
      allocatedAdmin,
      netAfterAdminAlloc,
      administrationFees,
      netAfterFees,
      marginAfterFeesPct: revenue > 0 ? (netAfterFees / revenue) * 100 : null,
      scheduled,
      confirmed,
    };
  }, [report]);

  const trueNetTotals = useMemo(() => {
    if (!report || !report.trueNetPortfolioByMonth?.length) {
      return { propertyNoi: 0, administration: 0, netIncome: 0, marginPct: null as number | null };
    }
    let propertyNoi = 0;
    let administration = 0;
    let netIncome = 0;
    let revenueSum = 0;
    for (const r of report.trueNetPortfolioByMonth) {
      propertyNoi += r.propertyNoi;
      administration += r.administrationTotal;
      netIncome += r.netIncome;
      const pm = report.portfolioByMonth.find((x) => x.monthKey === r.monthKey);
      if (pm) revenueSum += pm.revenue.total;
    }
    return {
      propertyNoi,
      administration,
      netIncome,
      marginPct: revenueSum > 0 ? (netIncome / revenueSum) * 100 : null,
    };
  }, [report]);

  const administrationCostTotals = useMemo(() => {
    const buckets: Record<string, number> = {};
    for (const k of NET_INCOME_COST_KEYS) buckets[k] = 0;
    let total = 0;
    if (!report?.administrationByMonth?.length) {
      return { buckets, total: 0 };
    }
    for (const r of report.administrationByMonth) {
      for (const k of NET_INCOME_COST_KEYS) {
        buckets[k] += (r.costs as Record<string, number>)[k] ?? 0;
      }
      total += r.total;
    }
    return { buckets, total };
  }, [report]);

  const runGenerate = useCallback(async () => {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/reports/net-income", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as NetIncomeReportModel | { error?: string };
      if (!res.ok || "error" in json) {
        setGenError((json as { error?: string }).error ?? "Failed to build report");
        setReport(null);
        return;
      }
      setReport(json as NetIncomeReportModel);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Failed to build report");
      setReport(null);
    } finally {
      setGenerating(false);
    }
  }, [body]);

  const toggleProperty = (id: string) => {
    setSelectedPropertyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const downloadProfessionalPack = async (format: "pdf" | "excel") => {
    setProExport(format);
    setGenError(null);
    try {
      const res = await fetch(`/api/reports/export/${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "net-income", ...body }),
      });
      const ct = res.headers.get("Content-Type") ?? "";
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setGenError(j.error ?? `Professional export failed (${res.status})`);
        return;
      }
      if (ct.includes("application/json")) {
        setGenError("Unexpected response from server");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition");
      let fname = format === "pdf" ? "net_income_professional.pdf" : "net_income_professional.xlsx";
      const m = cd?.match(/filename="?([^";]+)"?/);
      if (m?.[1]) fname = m[1];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Professional export failed");
    } finally {
      setProExport(null);
    }
  };

  if (loadingMeta) return <p style={{ color: "#666" }}>Loading…</p>;
  if (forbidden) {
    return (
      <main>
        <p style={{ color: "#b00020" }}>You don&apos;t have access to this report.</p>
        <Link href="/">Home</Link>
      </main>
    );
  }

  return (
    <main>
      <style
        dangerouslySetInnerHTML={{
          __html: `@media print { .no-print { display: none !important; } }`,
        }}
      />

      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: "0 0 8px" }}>Net income report</h1>
          <p style={{ margin: 0, color: "#555", maxWidth: 640 }}>
            Revenue (offices, bookings, services) minus operating costs per property. Scheduled recurring costs count in
            forecasts until you confirm or delete them.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "start" }}>
          <Link href="/reports" style={{ fontSize: 14 }}>
            All reports
          </Link>
          <Link href={isSuperAdmin ? "/super-admin" : "/dashboard"} style={{ fontSize: 14 }}>
            ← Back
          </Link>
        </div>
      </div>

      <section className="no-print" style={{ marginTop: 20, maxWidth: 720 }}>
        <h2 style={{ fontSize: 16 }}>Scope &amp; dates</h2>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <input type="radio" checked={allProperties} onChange={() => setAllProperties(true)} />
          <span>{isSuperAdmin ? "All properties" : "All my properties"}</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <input
            type="radio"
            checked={!allProperties}
            onChange={() => {
              setAllProperties(false);
              if (selectedPropertyIds.length === 0 && properties[0]) setSelectedPropertyIds([properties[0].id]);
            }}
          />
          <span>Selected properties</span>
        </label>
        {!allProperties ? (
          <div
            style={{
              display: "grid",
              gap: 8,
              marginTop: 8,
              maxHeight: 200,
              overflow: "auto",
              border: "1px solid #eee",
              padding: 12,
              borderRadius: 10,
            }}
          >
            {properties.map((p) => (
              <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={selectedPropertyIds.includes(p.id)} onChange={() => toggleProperty(p.id)} />
                <span>
                  {p.name}
                  {p.city ? ` · ${p.city}` : ""}
                </span>
              </label>
            ))}
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14, maxWidth: 420 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Start</span>
            <input type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>End</span>
            <input type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} style={inputStyle} />
          </label>
        </div>
        <div className="no-print" style={{ marginTop: 14, display: "grid", gap: 10, maxWidth: 560 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 14, cursor: "pointer", maxWidth: 520 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={includeAdministration}
                onChange={(e) => {
                  setIncludeAdministration(e.target.checked);
                  if (!e.target.checked) setAllocateAdminByRevenue(false);
                }}
              />
              Include central administration costs
            </span>
            <span style={{ fontSize: 12, color: "#666", paddingLeft: 24 }}>
              Costs not assigned to a specific property
            </span>
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              cursor: includeAdministration ? "pointer" : "not-allowed",
              opacity: includeAdministration ? 1 : 0.5,
            }}
          >
            <input
              type="checkbox"
              disabled={!includeAdministration}
              checked={allocateAdminByRevenue}
              onChange={(e) => setAllocateAdminByRevenue(e.target.checked)}
            />
            Allocate administration to properties by revenue share (shows per-property &quot;after admin&quot; column)
          </label>
        </div>
      </section>

      {isSuperAdmin ? <AdminFeeSettingsPanel endDate={range.end} /> : null}

      <div
        className="no-print"
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20, alignItems: "center", maxWidth: 900 }}
      >
        <button type="button" disabled={generating || !!proExport} onClick={() => void runGenerate()} style={btnPrimary}>
          {generating ? "Building…" : "Generate report"}
        </button>
        <button type="button" disabled={!report || !!proExport} onClick={() => window.print()} style={btnGhost}>
          Print / Save as PDF
        </button>
        <button
          type="button"
          disabled={generating || !!proExport}
          onClick={() => void downloadProfessionalPack("pdf")}
          style={btnGhost}
        >
          {proExport === "pdf" ? "Preparing PDF…" : "Professional PDF"}
        </button>
        <button
          type="button"
          disabled={generating || !!proExport}
          onClick={() => void downloadProfessionalPack("excel")}
          style={btnGhost}
        >
          {proExport === "excel" ? "Preparing Excel…" : "Professional Excel"}
        </button>
      </div>
      <p className="no-print" style={{ fontSize: 12, color: "#666", marginTop: 10, maxWidth: 640 }}>
        <strong>Professional</strong> packs include VAT (FI 25.5% / 10%), P&amp;L with ex- and incl.-VAT columns, data
        provenance, and indicative net VAT. Set <code>REPORT_BRAND_NAME</code> and <code>REPORT_LOGO_URL</code> for
        branded covers.
      </p>

      {genError ? (
        <p className="no-print" style={{ color: "#b00020", marginTop: 16 }}>
          {genError}
        </p>
      ) : null}

      {report ? (
        <div id="net-income-print" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16 }}>Portfolio by month (property NOI — property costs only)</h2>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={niThLeft}>Month</th>
                  <th style={niThRight}>Revenue</th>
                  <th style={niThRight}>Property costs</th>
                  <th style={niThRight}>NOI</th>
                  <th style={niThRight}>Margin</th>
                  <th style={{ ...niThRight, minWidth: 120 }}>Administration fees</th>
                  <th style={{ ...niThRight, minWidth: 112 }}>Net after fees</th>
                  <th style={{ ...niThRight, minWidth: 100 }}>Margin (after fees)</th>
                </tr>
              </thead>
              <tbody>
                {report.portfolioByMonth.map((r, i) => {
                  const bg = niStripe(i);
                  const feeLines = portfolioAdminFeeLines.get(r.monthKey) ?? [];
                  const adminCfg = r.administrationFeesTotal ?? 0;
                  const platformFee = r.platformManagementFee ?? 0;
                  const feeTotal = adminCfg + platformFee;
                  const netAfter =
                    r.netIncomeAfterPlatformFee ?? r.netIncomeAfterAdminFees ?? r.netIncome;
                  const marginAfter =
                    r.netMarginPctAfterPlatformFee ?? r.netMarginPctAfterAdminFees ?? null;
                  return (
                    <tr key={r.monthKey}>
                      <td style={niTdLeft(bg)}>{r.monthKey}</td>
                      <td style={niTdRight(bg)}>{money(r.revenue.total)}</td>
                      <td style={niTdRight(bg)}>{money(r.costs.total)}</td>
                      <td style={niTdRight(bg)}>
                        <strong>{money(r.netIncome)}</strong>
                      </td>
                      <td style={niTdRight(bg)}>{pct(r.netMarginPct)}</td>
                      <td style={{ ...niTdRightWrap(bg), minWidth: 120 }}>
                        {isSuperAdmin ? (
                          <div style={{ fontSize: 13 }}>
                            {feeLines.length > 0 ? (
                              feeLines.map((line) => (
                                <div key={line.settingId} style={{ marginBottom: 8 }}>
                                  <div style={{ fontWeight: 600 }}>{line.reportPrimary}</div>
                                  {line.reportSubtext ? (
                                    <div style={{ fontSize: 12, color: "#555", marginTop: 2, whiteSpace: "pre-line" }}>
                                      {line.reportSubtext}
                                    </div>
                                  ) : null}
                                  <div style={{ marginTop: 2 }}>{money(line.amount)}</div>
                                </div>
                              ))
                            ) : (
                              <div>{money(adminCfg)}</div>
                            )}
                            {platformFee > 0 ? (
                              <div style={{ marginTop: feeLines.length ? 8 : 0 }}>
                                <div style={{ fontWeight: 600 }}>Platform management fee</div>
                                <div style={{ marginTop: 2 }}>{money(platformFee)}</div>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div>
                            <div>{money(feeTotal)}</div>
                            <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>
                              Config + platform fees (if any)
                            </div>
                          </div>
                        )}
                      </td>
                      <td style={{ ...niTdRight(bg), minWidth: 112 }}>
                        <strong>{money(netAfter)}</strong>
                      </td>
                      <td style={{ ...niTdRight(bg), minWidth: 100 }}>{pct(marginAfter)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={niFootLeft}>TOTAL</td>
                  <td style={niFootRight}>{money(portfolioByMonthTotals.revenue)}</td>
                  <td style={niFootRight}>{money(portfolioByMonthTotals.costs)}</td>
                  <td style={niFootRight}>
                    <strong>{money(portfolioByMonthTotals.noi)}</strong>
                  </td>
                  <td style={niFootRight}>{pct(portfolioByMonthTotals.marginPct)}</td>
                  <td style={niFootRightWrap}>{money(portfolioByMonthTotals.administrationFees)}</td>
                  <td style={niFootRight}>
                    <strong>{money(portfolioByMonthTotals.netAfterFees)}</strong>
                  </td>
                  <td style={niFootRight}>{pct(portfolioByMonthTotals.marginAfterFeesPct)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {report.trueNetPortfolioByMonth && report.trueNetPortfolioByMonth.length > 0 ? (
            <>
              <h2 style={{ fontSize: 16, marginTop: 24 }}>True net income (after administration)</h2>
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 13, width: "max-content", minWidth: "100%" }}>
                  <thead>
                    <tr>
                      <th style={niThLeft}>Month</th>
                      <th style={niThRight}>Property NOI</th>
                      <th style={niThRight}>Administration</th>
                      <th style={niThRight}>Net income</th>
                      <th style={niThRight}>Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.trueNetPortfolioByMonth.map((r, i) => {
                      const bg = niStripe(i);
                      return (
                        <tr key={`tn-${r.monthKey}`}>
                          <td style={niTdLeft(bg)}>{r.monthKey}</td>
                          <td style={niTdRight(bg)}>{money(r.propertyNoi)}</td>
                          <td style={niTdRight(bg)}>{money(r.administrationTotal)}</td>
                          <td style={niTdRight(bg)}>
                            <strong>{money(r.netIncome)}</strong>
                          </td>
                          <td style={niTdRight(bg)}>{pct(r.netMarginPct)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={niFootLeft}>TOTAL</td>
                      <td style={niFootRight}>{money(trueNetTotals.propertyNoi)}</td>
                      <td style={niFootRight}>{money(trueNetTotals.administration)}</td>
                      <td style={niFootRight}>
                        <strong>{money(trueNetTotals.netIncome)}</strong>
                      </td>
                      <td style={niFootRight}>{pct(trueNetTotals.marginPct)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          ) : null}

          {report.administrationByMonth && report.administrationByMonth.length > 0 ? (
            <>
              <h2 style={{ fontSize: 16, marginTop: 24 }}>Administration costs (portfolio)</h2>
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 13, width: "max-content", minWidth: "100%" }}>
                  <thead>
                    <tr>
                      <th style={niThLeft}>Month</th>
                      {NET_INCOME_COST_KEYS.map((k) => (
                        <th key={k} style={{ ...niThRight, minWidth: 96 }}>
                          {NET_INCOME_COST_LABELS[k] ?? String(k)}
                        </th>
                      ))}
                      <th style={{ ...niThRight, minWidth: 88 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.administrationByMonth.map((r, i) => {
                      const bg = niStripe(i);
                      return (
                        <tr key={`adm-${r.monthKey}`}>
                          <td style={niTdLeft(bg)}>{r.monthKey}</td>
                          {NET_INCOME_COST_KEYS.map((k) => (
                            <td key={k} style={niTdRight(bg)}>
                              {money((r.costs as Record<string, number>)[k] ?? 0)}
                            </td>
                          ))}
                          <td style={{ ...niTdRight(bg), fontWeight: 700 }}>{money(r.total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={niFootLeft}>TOTAL</td>
                      {NET_INCOME_COST_KEYS.map((k) => (
                        <td key={k} style={niFootRight}>
                          {money(administrationCostTotals.buckets[k] ?? 0)}
                        </td>
                      ))}
                      <td style={niFootRight}>
                        <strong>{money(administrationCostTotals.total)}</strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          ) : null}

          <h2 style={{ fontSize: 16, marginTop: 28 }}>Revenue detail (portfolio)</h2>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={niThLeft}>Month</th>
                  <th style={niThRight}>Office</th>
                  <th style={niThRight}>Meeting</th>
                  <th style={niThRight}>Hot desk</th>
                  <th style={niThRight}>Venue</th>
                  <th style={niThRight}>Virt. off.</th>
                  <th style={niThRight}>Furniture</th>
                  <th style={niThRight}>Services</th>
                  <th style={{ ...niThRight, minWidth: 96 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {report.portfolioByMonth.map((r, i) => {
                  const bg = niStripe(i);
                  return (
                    <tr key={`rev-${r.monthKey}`}>
                      <td style={niTdLeft(bg)}>{r.monthKey}</td>
                      <td style={niTdRight(bg)}>{money(r.revenue.office)}</td>
                      <td style={niTdRight(bg)}>{money(r.revenue.meeting)}</td>
                      <td style={niTdRight(bg)}>{money(r.revenue.hotDesk)}</td>
                      <td style={niTdRight(bg)}>{money(r.revenue.venue)}</td>
                      <td style={niTdRight(bg)}>{money(r.revenue.virtualOffice)}</td>
                      <td style={niTdRight(bg)}>{money(r.revenue.furniture)}</td>
                      <td style={niTdRight(bg)}>{money(r.revenue.additionalServices)}</td>
                      <td style={{ ...niTdRight(bg), fontWeight: 700 }}>{money(r.revenue.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={niFootLeft}>TOTAL</td>
                  <td style={niFootRight}>{money(revenueDetailTotals.office)}</td>
                  <td style={niFootRight}>{money(revenueDetailTotals.meeting)}</td>
                  <td style={niFootRight}>{money(revenueDetailTotals.hotDesk)}</td>
                  <td style={niFootRight}>{money(revenueDetailTotals.venue)}</td>
                  <td style={niFootRight}>{money(revenueDetailTotals.virtualOffice)}</td>
                  <td style={niFootRight}>{money(revenueDetailTotals.furniture)}</td>
                  <td style={niFootRight}>{money(revenueDetailTotals.additionalServices)}</td>
                  <td style={niFootRight}>
                    <strong>{money(revenueDetailTotals.total)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <h2 style={{ fontSize: 16, marginTop: 28 }}>Costs by category (portfolio)</h2>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={niThLeft}>{SIMPLIFIED_COST_HEADERS.month}</th>
                  {SIMPLIFIED_COST_COLUMN_KEYS.map((k) => (
                    <th key={k} style={{ ...niThRight, maxWidth: 120 }}>
                      {SIMPLIFIED_COST_HEADERS[k]}
                    </th>
                  ))}
                  <th style={{ ...niThRight, minWidth: 88 }}>{SIMPLIFIED_COST_HEADERS.total}</th>
                </tr>
              </thead>
              <tbody>
                {portfolioSimplifiedCostTable.rows.map((r, i) => {
                  const bg = niStripe(i);
                  return (
                    <tr key={`cost-${r.monthKey}`}>
                      <td style={niTdLeft(bg)}>{r.monthKey}</td>
                      {SIMPLIFIED_COST_COLUMN_KEYS.map((k) => (
                        <td key={k} style={niTdRight(bg)}>
                          {moneyColored(r[k])}
                        </td>
                      ))}
                      <td style={{ ...niTdRight(bg), fontWeight: 700 }}>{moneyColored(r.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={niFootLeft}>TOTAL</td>
                  {SIMPLIFIED_COST_COLUMN_KEYS.map((k) => (
                    <td key={k} style={niFootRight}>
                      {moneyColored(portfolioSimplifiedCostTable.totals[k])}
                    </td>
                  ))}
                  <td style={niFootRight}>{moneyColored(portfolioSimplifiedCostTable.totals.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <h2 style={{ fontSize: 16, marginTop: 28 }}>Per property &amp; month</h2>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={niThLeft}>Property</th>
                  <th style={niThPlain}>Month</th>
                  <th style={niThRight}>Revenue</th>
                  <th style={niThRight}>Costs</th>
                  <th style={niThRight}>NOI</th>
                  <th style={niThRight}>Margin</th>
                  {hasAllocatedAdminCol ? (
                    <>
                      <th style={niThRight}>Alloc. admin</th>
                      <th style={niThRight}>Net after admin</th>
                    </>
                  ) : null}
                  {hasAdminFees ? (
                    <>
                      <th style={niThRight}>Administration fees</th>
                      <th style={niThRight}>Net after fees</th>
                      <th style={niThRight}>Margin (after fees)</th>
                    </>
                  ) : null}
                  <th style={niThRight}>Sched.</th>
                  <th style={niThRight}>Conf.</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r, i) => {
                  const bg = niStripe(i);
                  return (
                    <tr key={`${r.propertyId}-${r.monthKey}`}>
                      <td style={niTdLeft(bg)}>{String(r.propertyName ?? "")}</td>
                      <td style={niTdPlainLeft(bg)}>{r.monthKey}</td>
                      <td style={niTdRight(bg)}>{money(r.revenue.total)}</td>
                      <td style={niTdRight(bg)}>{money(r.costs.total)}</td>
                      <td style={niTdRight(bg)}>
                        <strong>{money(r.netIncome)}</strong>
                      </td>
                      <td style={niTdRight(bg)}>{pct(r.netMarginPct)}</td>
                      {hasAllocatedAdminCol ? (
                        <>
                          <td style={niTdRight(bg)}>{money(r.allocatedAdministrationCost ?? 0)}</td>
                          <td style={niTdRight(bg)}>
                            <strong>{money(r.netIncomeAfterAdminAllocation ?? r.netIncome)}</strong>
                          </td>
                        </>
                      ) : null}
                      {hasAdminFees ? (
                        <>
                          <td style={niTdRightWrap(bg)}>
                            {isSuperAdmin ? (
                              <div style={{ fontSize: 13 }}>
                                {(r.administrationFees ?? []).map((line) => (
                                  <div key={line.settingId} style={{ marginBottom: 8 }}>
                                    <div style={{ fontWeight: 600 }}>{line.reportPrimary ?? line.name}</div>
                                    {line.reportSubtext ? (
                                      <div style={{ fontSize: 12, color: "#555", marginTop: 2, whiteSpace: "pre-line" }}>
                                        {line.reportSubtext}
                                      </div>
                                    ) : null}
                                    <div style={{ marginTop: 2 }}>{money(line.amount)}</div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div>
                                {(r.administrationFees ?? []).map((line) => (
                                  <div key={line.settingId} style={{ marginBottom: 8 }}>
                                    <div style={{ fontWeight: 600 }}>{line.reportPrimary ?? line.name}</div>
                                    {line.reportSubtext ? (
                                      <div style={{ fontSize: 12, color: "#555", marginTop: 2, whiteSpace: "pre-line" }}>
                                        {line.reportSubtext}
                                      </div>
                                    ) : null}
                                    <div style={{ marginTop: 2 }}>{money(line.amount)}</div>
                                  </div>
                                ))}
                                {(r.administrationFees?.length ?? 0) > 0 ? (
                                  <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
                                    Set by platform administrator
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td style={niTdRight(bg)}>
                            <strong>
                              {money(
                                r.netIncomeAfterPlatformFee ?? r.netIncomeAfterAdminFees ?? r.netIncome,
                              )}
                            </strong>
                          </td>
                          <td style={niTdRight(bg)}>
                            {pct(r.netMarginPctAfterPlatformFee ?? r.netMarginPctAfterAdminFees ?? null)}
                          </td>
                        </>
                      ) : null}
                      <td style={niTdRight(bg)}>{money(r.costsScheduled)}</td>
                      <td style={niTdRight(bg)}>{money(r.costsConfirmed)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={niFootLeft}>TOTAL</td>
                  <td style={niFootPlainLeft}>{"\u00a0"}</td>
                  <td style={niFootRight}>{money(perPropertyTotals.revenue)}</td>
                  <td style={niFootRight}>{money(perPropertyTotals.costs)}</td>
                  <td style={niFootRight}>
                    <strong>{money(perPropertyTotals.noi)}</strong>
                  </td>
                  <td style={niFootRight}>{pct(perPropertyTotals.marginPct)}</td>
                  {hasAllocatedAdminCol ? (
                    <>
                      <td style={niFootRight}>{money(perPropertyTotals.allocatedAdmin)}</td>
                      <td style={niFootRight}>
                        <strong>{money(perPropertyTotals.netAfterAdminAlloc)}</strong>
                      </td>
                    </>
                  ) : null}
                  {hasAdminFees ? (
                    <>
                      <td style={niFootRightWrap}>{money(perPropertyTotals.administrationFees)}</td>
                      <td style={niFootRight}>
                        <strong>{money(perPropertyTotals.netAfterFees)}</strong>
                      </td>
                      <td style={niFootRight}>{pct(perPropertyTotals.marginAfterFeesPct)}</td>
                    </>
                  ) : null}
                  <td style={niFootRight}>{money(perPropertyTotals.scheduled)}</td>
                  <td style={niFootRight}>{money(perPropertyTotals.confirmed)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {!isSuperAdmin && hasAdminFees ? (
            <p style={{ fontSize: 12, color: "#666", marginTop: 8, maxWidth: 640 }}>
              Administration fees are configured by the platform. They reduce net income after property operating costs.
            </p>
          ) : null}

          <p style={{ fontSize: 12, color: "#666", marginTop: 20 }}>
            Revenue includes <strong>historical_revenue</strong> (P&amp;L imports) plus live leases, bookings, and services.
            Costs combine <strong>property_cost_entries</strong> and <strong>historical_costs</strong>; account codes map to
            P&amp;L categories. Duplicate historical rows (same property, month, account) with identical amounts are
            collapsed. Plan and track targets in <Link href="/budget">Budget &amp; forecast</Link>.
          </p>
        </div>
      ) : null}
    </main>
  );
}

const btnPrimary: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  cursor: "pointer",
};

const btnGhost: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "#fff",
  cursor: "pointer",
};

const inputStyle: CSSProperties = { padding: 10, borderRadius: 8, border: "1px solid #ddd" };

/** Net income report tables — petrol header, stripes, bold TOTAL footer */
const NI_HEADER_BG = "#1a4a4a";
const NI_HEADER_EDGE = "#0d3333";
const NI_FOOT_BG = "#dfecea";

function niStripe(i: number): string {
  return i % 2 === 0 ? "#ffffff" : "#f8fafa";
}

const niThRight: CSSProperties = {
  whiteSpace: "nowrap",
  padding: "8px 12px",
  fontSize: 13,
  fontWeight: 500,
  textAlign: "right",
  verticalAlign: "bottom",
  borderBottom: `1px solid ${NI_HEADER_EDGE}`,
  background: NI_HEADER_BG,
  color: "#fff",
};

const niThLeft: CSSProperties = {
  ...niThRight,
  textAlign: "left",
  position: "sticky",
  left: 0,
  zIndex: 4,
  boxShadow: "4px 0 8px rgba(0,0,0,0.12)",
};

/** Left-aligned header without sticky (e.g. second label column) */
const niThPlain: CSSProperties = {
  whiteSpace: "nowrap",
  padding: "8px 12px",
  fontSize: 13,
  fontWeight: 500,
  textAlign: "left",
  verticalAlign: "bottom",
  borderBottom: `1px solid ${NI_HEADER_EDGE}`,
  background: NI_HEADER_BG,
  color: "#fff",
};

const niTdRight = (bg: string): CSSProperties => ({
  padding: "8px 12px",
  fontSize: 13,
  textAlign: "right",
  whiteSpace: "nowrap",
  borderBottom: "1px solid #eceeee",
  background: bg,
});

const niTdRightWrap = (bg: string): CSSProperties => ({
  ...niTdRight(bg),
  whiteSpace: "normal",
});

const niTdLeft = (bg: string): CSSProperties => ({
  ...niTdRight(bg),
  textAlign: "left",
  position: "sticky",
  left: 0,
  zIndex: 2,
  boxShadow: "3px 0 6px rgba(0,0,0,0.05)",
});

const niTdPlainLeft = (bg: string): CSSProperties => ({
  padding: "8px 12px",
  fontSize: 13,
  textAlign: "left",
  whiteSpace: "nowrap",
  borderBottom: "1px solid #eceeee",
  background: bg,
});

const niFootLeft: CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  textAlign: "left",
  whiteSpace: "nowrap",
  borderTop: "2px solid #1a4a4a",
  borderBottom: "1px solid #eceeee",
  background: NI_FOOT_BG,
  fontWeight: 700,
  position: "sticky",
  left: 0,
  zIndex: 2,
  boxShadow: "3px 0 6px rgba(0,0,0,0.05)",
};

const niFootPlainLeft: CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  textAlign: "left",
  whiteSpace: "nowrap",
  borderTop: "2px solid #1a4a4a",
  borderBottom: "1px solid #eceeee",
  background: NI_FOOT_BG,
  fontWeight: 700,
};

const niFootRight: CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  textAlign: "right",
  whiteSpace: "nowrap",
  borderTop: "2px solid #1a4a4a",
  borderBottom: "1px solid #eceeee",
  background: NI_FOOT_BG,
  fontWeight: 700,
};

const niFootRightWrap: CSSProperties = {
  ...niFootRight,
  whiteSpace: "normal",
};

export default function NetIncomeReportPage() {
  return (
    <Suspense fallback={<p style={{ color: "#666" }}>Loading…</p>}>
      <NetIncomeInner />
    </Suspense>
  );
}
