"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import type { NetIncomeReportModel } from "@/lib/reports/net-income-types";
import { REPORT_READER_ROLES } from "@/lib/reports/report-access";
import { NET_INCOME_COST_KEYS, NET_INCOME_COST_LABELS } from "@/lib/reports/net-income-cost-accounts";
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

  const hasPlatformFees = useMemo(() => {
    if (!report) return false;
    return report.rows.some((r) => (r.platformManagementFee ?? 0) > 0);
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
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={includeAdministration}
              onChange={(e) => {
                setIncludeAdministration(e.target.checked);
                if (!e.target.checked) setAllocateAdminByRevenue(false);
              }}
            />
            Include administration costs (org-central / HQ from historical imports,{" "}
            <code>cost_scope=administration</code> or <code>property_id</code> null)
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
        <div className="no-print" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, alignItems: "center" }}>
          <button type="button" disabled={generating || !!proExport} onClick={() => void runGenerate()} style={btnPrimary}>
            {generating ? "Building…" : "Generate report"}
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
        {isSuperAdmin ? <AdminFeeSettingsPanel dateRange={range} /> : null}
      </section>

      {genError ? (
        <p className="no-print" style={{ color: "#b00020", marginTop: 16 }}>
          {genError}
        </p>
      ) : null}

      {report ? (
        <div id="net-income-print" style={{ marginTop: 24 }}>
          <div className="no-print" style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" onClick={() => window.print()} style={btnGhost}>
              Print / Save as PDF
            </button>
            <button type="button" disabled={!!proExport} onClick={() => void downloadProfessionalPack("pdf")} style={btnGhost}>
              {proExport === "pdf" ? "Preparing…" : "Professional PDF"}
            </button>
            <button
              type="button"
              disabled={!!proExport}
              onClick={() => void downloadProfessionalPack("excel")}
              style={btnGhost}
            >
              {proExport === "excel" ? "Preparing…" : "Professional Excel"}
            </button>
          </div>

          <h2 style={{ fontSize: 16 }}>Portfolio by month (property NOI — property costs only)</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Month</th>
                  <th style={thR}>Revenue</th>
                  <th style={thR}>Property costs</th>
                  <th style={thR}>NOI</th>
                  <th style={thR}>Margin</th>
                  {hasPlatformFees ? (
                    <>
                      <th style={thR}>{isSuperAdmin ? "Platform mgmt fee" : "Management fee (set by platform)"}</th>
                      <th style={thR}>{isSuperAdmin ? "Net after platform fee" : "Net after fee"}</th>
                      <th style={thR}>Margin (after fee)</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {report.portfolioByMonth.map((r) => (
                  <tr key={r.monthKey}>
                    <td style={td}>{r.monthKey}</td>
                    <td style={tdR}>{money(r.revenue.total)}</td>
                    <td style={tdR}>{money(r.costs.total)}</td>
                    <td style={tdR}>
                      <strong>{money(r.netIncome)}</strong>
                    </td>
                    <td style={tdR}>{pct(r.netMarginPct)}</td>
                    {hasPlatformFees ? (
                      <>
                        <td style={tdR}>{money(r.platformManagementFee ?? 0)}</td>
                        <td style={tdR}>
                          <strong>{money(r.netIncomeAfterPlatformFee ?? r.netIncome)}</strong>
                        </td>
                        <td style={tdR}>{pct(r.netMarginPctAfterPlatformFee ?? null)}</td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.trueNetPortfolioByMonth && report.trueNetPortfolioByMonth.length > 0 ? (
            <>
              <h2 style={{ fontSize: 16, marginTop: 24 }}>True net income (after administration)</h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={th}>Month</th>
                      <th style={thR}>Property NOI</th>
                      <th style={thR}>Administration</th>
                      <th style={thR}>Net income</th>
                      <th style={thR}>Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.trueNetPortfolioByMonth.map((r) => (
                      <tr key={`tn-${r.monthKey}`}>
                        <td style={td}>{r.monthKey}</td>
                        <td style={tdR}>{money(r.propertyNoi)}</td>
                        <td style={tdR}>{money(r.administrationTotal)}</td>
                        <td style={tdR}>
                          <strong>{money(r.netIncome)}</strong>
                        </td>
                        <td style={tdR}>{pct(r.netMarginPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {report.administrationByMonth && report.administrationByMonth.length > 0 ? (
            <>
              <h2 style={{ fontSize: 16, marginTop: 24 }}>Administration costs (portfolio)</h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={th}>Month</th>
                      {NET_INCOME_COST_KEYS.map((k) => (
                        <th key={k} style={thR}>
                          {(NET_INCOME_COST_LABELS[k] ?? String(k)).slice(0, 10)}
                        </th>
                      ))}
                      <th style={thR}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.administrationByMonth.map((r) => (
                      <tr key={`adm-${r.monthKey}`}>
                        <td style={td}>{r.monthKey}</td>
                        {NET_INCOME_COST_KEYS.map((k) => (
                          <td key={k} style={tdR}>
                            {money((r.costs as Record<string, number>)[k] ?? 0)}
                          </td>
                        ))}
                        <td style={tdR}>
                          <strong>{money(r.total)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <h2 style={{ fontSize: 16, marginTop: 28 }}>Revenue detail (portfolio)</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Month</th>
                  <th style={thR}>Office</th>
                  <th style={thR}>Meeting</th>
                  <th style={thR}>Hot desk</th>
                  <th style={thR}>Venue</th>
                  <th style={thR}>Virt. off.</th>
                  <th style={thR}>Furniture</th>
                  <th style={thR}>Services</th>
                </tr>
              </thead>
              <tbody>
                {report.portfolioByMonth.map((r) => (
                  <tr key={`rev-${r.monthKey}`}>
                    <td style={td}>{r.monthKey}</td>
                    <td style={tdR}>{money(r.revenue.office)}</td>
                    <td style={tdR}>{money(r.revenue.meeting)}</td>
                    <td style={tdR}>{money(r.revenue.hotDesk)}</td>
                    <td style={tdR}>{money(r.revenue.venue)}</td>
                    <td style={tdR}>{money(r.revenue.virtualOffice)}</td>
                    <td style={tdR}>{money(r.revenue.furniture)}</td>
                    <td style={tdR}>{money(r.revenue.additionalServices)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={{ fontSize: 16, marginTop: 28 }}>Costs by category (portfolio)</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={th}>Month</th>
                  {NET_INCOME_COST_KEYS.map((k) => (
                    <th key={k} style={thR}>
                      {(NET_INCOME_COST_LABELS[k] ?? String(k)).slice(0, 12)}
                    </th>
                  ))}
                  <th style={thR}>Total</th>
                </tr>
              </thead>
              <tbody>
                {report.portfolioByMonth.map((r) => (
                  <tr key={`cost-${r.monthKey}`}>
                    <td style={td}>{r.monthKey}</td>
                    {NET_INCOME_COST_KEYS.map((k) => (
                      <td key={k} style={tdR}>
                        {money((r.costs as Record<string, number>)[k] ?? 0)}
                      </td>
                    ))}
                    <td style={tdR}>
                      <strong>{money(r.costs.total)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={{ fontSize: 16, marginTop: 28 }}>Per property &amp; month</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={th}>Property</th>
                  <th style={th}>Month</th>
                  <th style={thR}>Revenue</th>
                  <th style={thR}>Costs</th>
                  <th style={thR}>NOI</th>
                  <th style={thR}>Margin</th>
                  {report.rows.some((x) => x.allocatedAdministrationCost != null) ? (
                    <>
                      <th style={thR}>Alloc. admin</th>
                      <th style={thR}>Net after admin</th>
                    </>
                  ) : null}
                  {hasPlatformFees ? (
                    <>
                      <th style={thR}>{isSuperAdmin ? "Platform mgmt fee" : "Management fee (set by platform)"}</th>
                      <th style={thR}>{isSuperAdmin ? "Net after platform fee" : "Net after fee"}</th>
                      <th style={thR}>Margin (after fee)</th>
                    </>
                  ) : null}
                  <th style={thR}>Sched.</th>
                  <th style={thR}>Conf.</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={`${r.propertyId}-${r.monthKey}`}>
                    <td style={td}>{String(r.propertyName ?? "")}</td>
                    <td style={td}>{r.monthKey}</td>
                    <td style={tdR}>{money(r.revenue.total)}</td>
                    <td style={tdR}>{money(r.costs.total)}</td>
                    <td style={tdR}>
                      <strong>{money(r.netIncome)}</strong>
                    </td>
                    <td style={tdR}>{pct(r.netMarginPct)}</td>
                    {report.rows.some((x) => x.allocatedAdministrationCost != null) ? (
                      <>
                        <td style={tdR}>{money(r.allocatedAdministrationCost ?? 0)}</td>
                        <td style={tdR}>
                          <strong>{money(r.netIncomeAfterAdminAllocation ?? r.netIncome)}</strong>
                        </td>
                      </>
                    ) : null}
                    {hasPlatformFees ? (
                      <>
                        <td style={tdR}>
                          {isSuperAdmin ? (
                            money(r.platformManagementFee ?? 0)
                          ) : (
                            <>
                              <div>Management fee: {money(r.platformManagementFee ?? 0)}</div>
                              {(r.platformManagementFee ?? 0) > 0 ? (
                                <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
                                  Calculated by platform administrator
                                </div>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td style={tdR}>
                          <strong>{money(r.netIncomeAfterPlatformFee ?? r.netIncome)}</strong>
                        </td>
                        <td style={tdR}>{pct(r.netMarginPctAfterPlatformFee ?? null)}</td>
                      </>
                    ) : null}
                    <td style={tdR}>{money(r.costsScheduled)}</td>
                    <td style={tdR}>{money(r.costsConfirmed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!isSuperAdmin && hasPlatformFees ? (
            <p style={{ fontSize: 12, color: "#666", marginTop: 8, maxWidth: 640 }}>
              Management fees are set by the platform and appear in your P&amp;L as shown. You cannot change them here.
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

const th: CSSProperties = {
  textAlign: "left",
  padding: "8px",
  borderBottom: "1px solid #ddd",
  background: "#fafafa",
};
const thR: CSSProperties = { ...th, textAlign: "right" };
const td: CSSProperties = { padding: "8px", borderBottom: "1px solid #f0f0f0" };
const tdR: CSSProperties = { ...td, textAlign: "right" };

export default function NetIncomeReportPage() {
  return (
    <Suspense fallback={<p style={{ color: "#666" }}>Loading…</p>}>
      <NetIncomeInner />
    </Suspense>
  );
}
