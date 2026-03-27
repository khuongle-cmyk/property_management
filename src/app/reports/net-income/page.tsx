"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import type { NetIncomeReportModel } from "@/lib/reports/net-income-types";
import { REPORT_READER_ROLES } from "@/lib/reports/report-access";
import { PROPERTY_COST_TYPE_LABELS } from "@/lib/property-costs/constants";

type PropertyRow = { id: string; name: string; city: string | null; tenant_id: string };
type MembershipRow = { tenant_id: string | null; role: string | null };

function money(n: number): string {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(n);
}

function pct(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(1)}%`;
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
      const { data: mem } = await supabase.from("memberships").select("tenant_id, role");
      if (cancelled) return;
      const roles = (mem ?? []).map((m: MembershipRow) => (m.role ?? "").toLowerCase());
      if (!roles.some((r: string) => REPORT_READER_ROLES.has(r))) {
        setForbidden(true);
        setLoadingMeta(false);
        return;
      }
      const superA = roles.includes("super_admin");
      setIsSuperAdmin(superA);
      const tenantIds = [...new Set((mem ?? []).map((m: MembershipRow) => m.tenant_id).filter(Boolean))] as string[];
      let pq = supabase.from("properties").select("id, name, city, tenant_id").order("name");
      if (!superA) {
        if (tenantIds.length === 0) {
          setProperties([]);
          setLoadingMeta(false);
          return;
        }
        pq = pq.in("tenant_id", tenantIds);
      }
      const { data: props, error } = await pq;
      if (cancelled) return;
      if (error) {
        setGenError(error.message);
        setLoadingMeta(false);
        return;
      }
      const plist = (props as PropertyRow[]) ?? [];
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
    }),
    [allProperties, selectedPropertyIds, range],
  );

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

          <h2 style={{ fontSize: 16 }}>Portfolio by month</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Month</th>
                  <th style={thR}>Revenue</th>
                  <th style={thR}>Costs</th>
                  <th style={thR}>Net</th>
                  <th style={thR}>Margin</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
                  {(Object.keys(PROPERTY_COST_TYPE_LABELS) as (keyof typeof PROPERTY_COST_TYPE_LABELS)[]).map((k) => (
                    <th key={k} style={thR}>
                      {PROPERTY_COST_TYPE_LABELS[k].slice(0, 14)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.portfolioByMonth.map((r) => (
                  <tr key={`cost-${r.monthKey}`}>
                    <td style={td}>{r.monthKey}</td>
                    {(Object.keys(PROPERTY_COST_TYPE_LABELS) as (keyof typeof PROPERTY_COST_TYPE_LABELS)[]).map((k) => (
                      <td key={k} style={tdR}>
                        {money((r.costs as Record<string, number>)[k] ?? 0)}
                      </td>
                    ))}
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
                  <th style={thR}>Net</th>
                  <th style={thR}>Margin</th>
                  <th style={thR}>Sched.</th>
                  <th style={thR}>Conf.</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={`${r.propertyId}-${r.monthKey}`}>
                    <td style={td}>{r.propertyName}</td>
                    <td style={td}>{r.monthKey}</td>
                    <td style={tdR}>{money(r.revenue.total)}</td>
                    <td style={tdR}>{money(r.costs.total)}</td>
                    <td style={tdR}>
                      <strong>{money(r.netIncome)}</strong>
                    </td>
                    <td style={tdR}>{pct(r.netMarginPct)}</td>
                    <td style={tdR}>{money(r.costsScheduled)}</td>
                    <td style={tdR}>{money(r.costsConfirmed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: 12, color: "#666", marginTop: 20 }}>
            Revenue aligns with the rent-roll engine (contract rent for offices, confirmed bookings by space type, posted
            additional services). Add and import costs on each property page.
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
