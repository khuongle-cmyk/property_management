"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import {
  defaultReportSections,
  type RentRollReportModel,
  type RentRollRequestBody,
  type ReportSections,
} from "@/lib/reports/rent-roll-types";
import { downloadRentRollExcel } from "@/lib/reports/rent-roll-excel";
import { REPORT_READER_ROLES } from "@/lib/reports/report-access";
import { spaceTypeLabel } from "@/lib/rooms/labels";
import { loadScopedPropertiesForUser } from "@/lib/properties/scoped";

type PropertyRow = { id: string; name: string; city: string | null; tenant_id: string };
type MembershipRow = { tenant_id: string | null; role: string | null };

function money(n: number): string {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(n);
}

function defaultRange(): { start: string; end: string } {
  const y = new Date().getUTCFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

function ReportBuilderInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prePropertyId = (searchParams.get("propertyId") ?? "").trim();

  const [loadingMeta, setLoadingMeta] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [step, setStep] = useState(1);
  const [allProperties, setAllProperties] = useState(true);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [range, setRange] = useState(defaultRange);
  const [sections, setSections] = useState<ReportSections>(() => defaultReportSections());
  const [targetMonthly, setTargetMonthly] = useState<string>("");

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [report, setReport] = useState<RentRollReportModel | null>(null);

  const [emailTo, setEmailTo] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);

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
      } else {
        setAllProperties(true);
        setSelectedPropertyIds([]);
      }

      setLoadingMeta(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, prePropertyId]);

  const requestBody = useMemo((): RentRollRequestBody => {
    const t = targetMonthly.trim() ? Number(targetMonthly) : null;
    return {
      propertyIds: allProperties ? null : selectedPropertyIds,
      startDate: range.start,
      endDate: range.end,
      sections: {
        ...sections,
        revenueVsTarget: sections.revenueVsTarget && t != null && !Number.isNaN(t) && t > 0,
      },
      revenueTargetMonthly: t != null && !Number.isNaN(t) ? t : null,
    };
  }, [allProperties, selectedPropertyIds, range, sections, targetMonthly]);

  const runGenerate = useCallback(async () => {
    setGenerating(true);
    setGenError(null);
    setEmailMsg(null);
    try {
      const res = await fetch("/api/reports/rent-roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const json = (await res.json()) as RentRollReportModel | { error?: string };
      if (!res.ok || "error" in json) {
        setGenError((json as { error?: string }).error ?? "Failed to build report");
        setReport(null);
        return;
      }
      setReport(json as RentRollReportModel);
      setStep(4);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Failed to build report");
      setReport(null);
    } finally {
      setGenerating(false);
    }
  }, [requestBody]);

  const exportExcel = () => {
    if (!report) return;
    const stamp = report.monthKeys.length ? `${report.monthKeys[0]}_${report.monthKeys[report.monthKeys.length - 1]}` : "report";
    downloadRentRollExcel(report, `rent_roll_${stamp}`);
  };

  const printPdf = () => {
    window.print();
  };

  const downloadProfessionalPack = async (format: "pdf" | "excel") => {
    setProExport(format);
    setGenError(null);
    try {
      const res = await fetch(`/api/reports/export/${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "rent-roll", ...requestBody }),
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
      let fname = format === "pdf" ? "rent_roll_professional.pdf" : "rent_roll_professional.xlsx";
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

  const sendEmail = async () => {
    if (!report || !emailTo.trim()) return;
    setEmailBusy(true);
    setEmailMsg(null);
    try {
      const res = await fetch("/api/reports/rent-roll/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail: emailTo.trim(), report }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setEmailMsg(j.error ?? "Send failed");
        return;
      }
      setEmailMsg("Report sent.");
    } catch (e) {
      setEmailMsg(e instanceof Error ? e.message : "Send failed");
    } finally {
      setEmailBusy(false);
    }
  };

  const toggleSection = (key: keyof ReportSections) => {
    setSections((s) => ({ ...s, [key]: !s[key] }));
  };

  const toggleProperty = (id: string) => {
    setSelectedPropertyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  if (loadingMeta) {
    return <p style={{ color: "#666" }}>Loading…</p>;
  }

  if (forbidden) {
    return (
      <main>
        <p style={{ color: "#b00020" }}>You don&apos;t have access to financial reports.</p>
        <Link href="/">Home</Link>
      </main>
    );
  }

  return (
    <main>
      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  .no-print { display: none !important; }
  body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  a { color: inherit; text-decoration: none; }
}`,
        }}
      />

      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="vw-admin-page-title" style={{ margin: "0 0 8px" }}>Rent roll &amp; revenue forecast</h1>
          <p style={{ margin: 0, color: "#555", maxWidth: 640 }}>
            Build a portfolio report from active leases, lease invoices, booking revenue, and add-on services. Owners see
            their tenants&apos; properties; super admins can run across the full portfolio.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignSelf: "start", fontSize: 14 }}>
          <Link href="/reports">All reports</Link>
          <Link href={isSuperAdmin ? "/super-admin" : "/dashboard"}>← Back</Link>
        </div>
      </div>

      <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setStep(n)}
            disabled={n === 4 && !report}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: `1px solid ${step === n ? "#111" : "#ddd"}`,
              background: step === n ? "#111" : "#fff",
              color: step === n ? "#fff" : "#111",
              cursor: n === 4 && !report ? "not-allowed" : "pointer",
              opacity: n === 4 && !report ? 0.5 : 1,
            }}
          >
            {n === 1 ? "1. Property" : n === 2 ? "2. Dates" : n === 3 ? "3. Sections" : "4. Preview & export"}
          </button>
        ))}
      </div>

      {step === 1 ? (
        <section style={{ marginTop: 20, maxWidth: 720 }}>
          <h2 style={{ fontSize: 18 }}>Select property scope</h2>
          <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0" }}>
            <input type="radio" checked={allProperties} onChange={() => setAllProperties(true)} />
            <span>{isSuperAdmin ? "All properties (portfolio)" : "All my properties"}</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0" }}>
            <input
              type="radio"
              checked={!allProperties}
              onChange={() => {
                setAllProperties(false);
                if (selectedPropertyIds.length === 0 && properties[0]) {
                  setSelectedPropertyIds([properties[0].id]);
                }
              }}
            />
            <span>Selected properties only</span>
          </label>
          {!allProperties ? (
            <div style={{ display: "grid", gap: 8, marginTop: 8, maxHeight: 280, overflow: "auto", border: "1px solid #eee", padding: 12, borderRadius: 10 }}>
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
          <div className="no-print" style={{ marginTop: 16 }}>
            <button type="button" onClick={() => setStep(2)} style={btnPrimary}>
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section style={{ marginTop: 20, maxWidth: 480 }}>
          <h2 style={{ fontSize: 18 }}>Date range</h2>
          <p style={{ color: "#666", fontSize: 14 }}>Any range is reduced to full calendar months for roll-ups.</p>
          <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
            <span>Start</span>
            <input type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
            <span>End</span>
            <input type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} style={inputStyle} />
          </label>
          <div className="no-print" style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setStep(1)} style={btnGhost}>
              Back
            </button>
            <button type="button" onClick={() => setStep(3)} style={btnPrimary}>
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section style={{ marginTop: 20, maxWidth: 640 }}>
          <h2 style={{ fontSize: 18 }}>Include in report</h2>
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {(
              [
                ["officeRents", "Office rents (active leases)"],
                ["meetingRoomRevenue", "Meeting / conference room booking revenue"],
                ["hotDeskRevenue", "Hot desk booking revenue"],
                ["venueRevenue", "Venue booking revenue"],
                ["additionalServices", "Additional services (invoiced add-ons)"],
                ["vacancyForecast", "Vacancy forecast (unleased offices, list rates)"],
                ["revenueVsTarget", "Revenue vs target (needs monthly target below)"],
                ["roomByRoom", "Room-by-room breakdown"],
                ["tenantByTenant", "Tenant / booker breakdown"],
                ["monthlySummary", "Monthly summary tables in preview"],
                ["showCosts", "Show costs (historical_costs: P&L buckets + net income)"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={sections[key]} onChange={() => toggleSection(key)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {sections.revenueVsTarget ? (
            <label style={{ display: "grid", gap: 6, marginTop: 16 }}>
              <span>Monthly revenue target (same currency as your data)</span>
              <input
                value={targetMonthly}
                onChange={(e) => setTargetMonthly(e.target.value)}
                placeholder="e.g. 50000"
                style={inputStyle}
              />
            </label>
          ) : null}
          <div className="no-print" style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setStep(2)} style={btnGhost}>
              Back
            </button>
            <button type="button" disabled={generating} onClick={() => void runGenerate()} style={btnPrimary}>
              {generating ? "Building…" : "Preview on screen"}
            </button>
          </div>
        </section>
      ) : null}

      {genError ? (
        <p className="no-print" style={{ color: "#b00020", marginTop: 16 }}>
          {genError}
        </p>
      ) : null}

      {step === 4 && report ? (
        <div id="report-print" style={{ marginTop: 24 }}>
          <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
            <button type="button" onClick={exportExcel} style={btnPrimary}>
              Export Excel
            </button>
            <button type="button" onClick={printPdf} style={btnGhost}>
              Print / Save as PDF
            </button>
            <button
              type="button"
              onClick={() => {
                exportExcel();
                setTimeout(() => printPdf(), 400);
              }}
              style={btnGhost}
            >
              Excel + PDF
            </button>
            <span style={{ color: "#ccc", margin: "0 4px" }}>|</span>
            <button
              type="button"
              disabled={!!proExport}
              onClick={() => void downloadProfessionalPack("pdf")}
              style={btnGhost}
            >
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
          <p className="no-print" style={{ fontSize: 12, color: "#666", margin: "0 0 12px" }}>
            <strong>Professional</strong> exports add Finnish VAT breakdown (25.5% / 10%), executive summary, data-source
            notes, and auditor-friendly Excel with formulas. Configure <code>REPORT_BRAND_NAME</code> and{" "}
            <code>REPORT_LOGO_URL</code> in server env for branding.
          </p>

          <p style={{ color: "#666", fontSize: 13 }}>
            {report.properties.map((p) => p.name).join(", ") || "Portfolio"} · {report.monthKeys[0]} –{" "}
            {report.monthKeys[report.monthKeys.length - 1]}
          </p>

          {sections.monthlySummary ? (
            <>
              <h2 style={{ fontSize: 16, marginTop: 20 }}>Monthly summary</h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={th}>Month</th>
                      <th style={th}>Office</th>
                      <th style={th}>Meeting</th>
                      <th style={th}>Hot desk</th>
                      <th style={th}>Venue</th>
                      <th style={th}>Virtual office</th>
                      <th style={th}>Furniture</th>
                      <th style={th}>Services</th>
                      <th style={th}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.monthlySummary.map((r) => (
                      <tr key={r.monthKey}>
                        <td style={td}>{r.monthKey}</td>
                        <td style={tdR}>{money(r.officeContractRent)}</td>
                        <td style={tdR}>{money(r.meetingRoomBookings)}</td>
                        <td style={tdR}>{money(r.hotDeskBookings)}</td>
                        <td style={tdR}>{money(r.venueBookings)}</td>
                        <td style={tdR}>{money(r.virtualOfficeRevenue)}</td>
                        <td style={tdR}>{money(r.furnitureRevenue)}</td>
                        <td style={tdR}>{money(r.additionalServices)}</td>
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

          {sections.showCosts && report.monthlyCostBreakdown.length ? (
            <>
              <h2 style={{ fontSize: 16, marginTop: 24 }}>Monthly costs &amp; net income</h2>
              <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
                Costs from <code>historical_costs</code> (4xxx materials &amp; services, 5xxx–6xxx personnel, 7xxx–9xxx other
                operating). Net figures use the same monthly revenue totals as the summary above.
              </p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={th}>Month</th>
                      <th style={th}>Materials &amp; services</th>
                      <th style={th}>Personnel</th>
                      <th style={th}>Other operating</th>
                      <th style={th}>Total costs</th>
                      <th style={th}>Revenue</th>
                      <th style={th}>Net income</th>
                      <th style={th}>Net margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.monthlyCostBreakdown.map((r) => (
                      <tr key={`cost-${r.monthKey}`}>
                        <td style={td}>{r.monthKey}</td>
                        <td style={tdR}>{money(r.materialsServices)}</td>
                        <td style={tdR}>{money(r.personnel)}</td>
                        <td style={tdR}>{money(r.otherOperating)}</td>
                        <td style={tdR}>{money(r.totalCosts)}</td>
                        <td style={tdR}>{money(r.revenueTotal)}</td>
                        <td style={tdR}>{money(r.netIncome)}</td>
                        <td style={tdR}>{r.netMarginPct != null ? `${r.netMarginPct.toFixed(1)}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {sections.revenueVsTarget && report.revenueVsTarget.length ? (
            <>
              <h2 style={{ fontSize: 16, marginTop: 24 }}>Revenue vs target</h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={th}>Month</th>
                      <th style={th}>Actual</th>
                      <th style={th}>Target</th>
                      <th style={th}>Variance</th>
                      <th style={th}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.revenueVsTarget.map((r) => (
                      <tr key={r.monthKey}>
                        <td style={td}>{r.monthKey}</td>
                        <td style={tdR}>{money(r.total)}</td>
                        <td style={tdR}>{money(r.target)}</td>
                        <td style={tdR}>{money(r.variance)}</td>
                        <td style={tdR}>{r.variancePct != null ? `${r.variancePct.toFixed(1)}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {sections.officeRents && report.officeRentRoll.length ? (
            <>
              <h2 style={{ fontSize: 16, marginTop: 24 }}>Office rent roll</h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={th}>Month</th>
                      <th style={th}>Property</th>
                      <th style={th}>Room</th>
                      <th style={th}>Space</th>
                      <th style={th}>Lessee</th>
                      <th style={th}>Lease</th>
                      <th style={th}>Rent</th>
                      <th style={th}>Invoiced</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.officeRentRoll.map((o) => (
                      <tr key={`${o.spaceId}-${o.monthKey}`}>
                        <td style={td}>{o.monthKey}</td>
                        <td style={td}>{o.propertyName}</td>
                        <td style={td}>{o.roomNumber ?? "—"}</td>
                        <td style={td}>{o.spaceName}</td>
                        <td style={td}>{o.lessee}</td>
                        <td style={td}>
                          {o.contractStart ?? "—"} → {o.contractEnd ?? "open"}
                        </td>
                        <td style={tdR}>{money(o.contractMonthlyRent)}</td>
                        <td style={tdR}>{o.invoicedTotal != null ? money(o.invoicedTotal) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {sections.vacancyForecast && report.vacancyForecast.length ? (
            <>
              <h2 style={{ fontSize: 16, marginTop: 24 }}>Vacancy forecast</h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={th}>Month</th>
                      <th style={th}>Property</th>
                      <th style={th}>Room</th>
                      <th style={th}>Space</th>
                      <th style={th}>Type</th>
                      <th style={th}>List € / mo</th>
                      <th style={th}>List € / hr</th>
                      <th style={th}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.vacancyForecast.map((v) => (
                      <tr key={`${v.spaceId}-${v.monthKey}-vac`}>
                        <td style={td}>{v.monthKey}</td>
                        <td style={td}>{v.propertyName}</td>
                        <td style={td}>{v.roomNumber ?? "—"}</td>
                        <td style={td}>{v.spaceName}</td>
                        <td style={td}>{spaceTypeLabel(v.spaceType)}</td>
                        <td style={tdR}>{v.listMonthlyRent != null ? money(v.listMonthlyRent) : "—"}</td>
                        <td style={tdR}>{v.listHourly != null ? money(v.listHourly) : "—"}</td>
                        <td style={{ ...td, maxWidth: 280 }}>{v.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {sections.tenantByTenant && report.tenantByTenant.length ? (
            <>
              <h2 style={{ fontSize: 16, marginTop: 24 }}>Tenant / booker breakdown</h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={th}>Name</th>
                      <th style={th}>Office</th>
                      <th style={th}>Bookings</th>
                      <th style={th}>Services</th>
                      <th style={th}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.tenantByTenant.map((t) => (
                      <tr key={t.bucketKey}>
                        <td style={td}>{t.displayName}</td>
                        <td style={tdR}>{money(t.officeContractRent)}</td>
                        <td style={tdR}>{money(t.bookingRevenue)}</td>
                        <td style={tdR}>{money(t.additionalServices)}</td>
                        <td style={tdR}>
                          <strong>{money(t.total)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {sections.roomByRoom && report.roomByRoom.length ? (
            <>
              <h2 style={{ fontSize: 16, marginTop: 24 }}>Room by room</h2>
              {report.roomByRoom.map((row) => (
                <div key={row.spaceId} style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600 }}>
                    {row.propertyName} · {row.roomNumber ?? "—"} · {row.spaceName} · {spaceTypeLabel(row.spaceType)}
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 6 }}>
                    <thead>
                      <tr>
                        <th style={th}>Month</th>
                        <th style={th}>Amount</th>
                        <th style={th}>Basis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.months.map((c) => (
                        <tr key={c.monthKey}>
                          <td style={td}>{c.monthKey}</td>
                          <td style={tdR}>{money(c.amount)}</td>
                          <td style={td}>{c.basis}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </>
          ) : null}

          <section className="no-print" style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid #eee", maxWidth: 480 }}>
            <h2 style={{ fontSize: 16 }}>Email report</h2>
            <p style={{ fontSize: 13, color: "#666" }}>Sends a concise HTML summary. Configure Resend (`RESEND_API_KEY`) on the server.</p>
            <label style={{ display: "grid", gap: 6, marginTop: 8 }}>
              <span>Recipient</span>
              <input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} style={inputStyle} placeholder="accounting@company.com" />
            </label>
            <button type="button" disabled={emailBusy || !emailTo.trim()} onClick={() => void sendEmail()} style={{ ...btnPrimary, marginTop: 10 }}>
              {emailBusy ? "Sending…" : "Send email"}
            </button>
            {emailMsg ? <p style={{ fontSize: 13, marginTop: 8 }}>{emailMsg}</p> : null}
          </section>
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
  color: "#111",
  cursor: "pointer",
};

const inputStyle: CSSProperties = { padding: 10, borderRadius: 8, border: "1px solid #ddd" };

const th: CSSProperties = {
  textAlign: "left",
  padding: "8px",
  borderBottom: "1px solid #ddd",
  background: "#fafafa",
};
const td: CSSProperties = { padding: "8px", borderBottom: "1px solid #f0f0f0", verticalAlign: "top" };
const tdR: CSSProperties = { ...td, textAlign: "right" };

export default function RentRollReportPage() {
  return (
    <Suspense fallback={<p style={{ color: "#666" }}>Loading…</p>}>
      <ReportBuilderInner />
    </Suspense>
  );
}
