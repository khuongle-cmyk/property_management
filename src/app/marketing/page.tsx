"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";

type DashboardJson = {
  /** Single-tenant id or `"all"` when super admin aggregates every organization */
  tenantId: string;
  monthRange: { start: string; end: string };
  kpis: {
    acquisition: {
      websiteVisitors: number;
      newLeads: number;
      leadConversionPct: number | null;
      costPerLead: number | null;
    };
    conversion: {
      leadToTenantPct: number | null;
      newTenantsMonth: number;
      avgConvertDays: number | null;
      revenueAttributed: number;
    };
    campaigns: {
      activeCampaigns: number;
      emailsSentMonth: number;
      avgOpenRatePct: number | null;
      smsDeliveryPct: number | null;
    };
  };
  charts: {
    funnel: Array<{ date: string; visitors: number; leads: number; bookings: number }>;
    revenueByChannel: Record<string, number>;
    campaignPerformance: Array<{ id: string; name: string; status: string; actual_spend: number; campaign_type: string }>;
    revenueTrend: Array<{ monthKey: string; revenue: number }>;
    events: Array<{ start_datetime: string; name: string }>;
  };
};

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        background: "#fff",
        border: "1px solid rgba(26,74,74,0.1)",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 12, color: "rgba(26,74,74,0.65)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

export default function MarketingDashboardPage() {
  const { querySuffix, loading: ctxLoading, dataReady } = useMarketingTenant();
  const [data, setData] = useState<DashboardJson | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dataReady) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/marketing/dashboard${querySuffix}`, { cache: "no-store" });
        const json = (await res.json()) as DashboardJson & { error?: string };
        if (!res.ok) {
          if (!cancelled) setErr(json.error ?? "Failed to load");
          if (!cancelled) setData(null);
          return;
        }
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataReady, querySuffix]);

  const channelData = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.charts.revenueByChannel).map(([name, value]) => ({ name, value }));
  }, [data]);

  const funnelAgg = useMemo(() => {
    if (!data || !data.charts.funnel.length) {
      return [
        { stage: "Visitors", value: data?.kpis.acquisition.websiteVisitors ?? 0 },
        { stage: "Leads", value: data?.kpis.acquisition.newLeads ?? 0 },
        { stage: "Tenants (mo)", value: data?.kpis.conversion.newTenantsMonth ?? 0 },
      ];
    }
    const last = data.charts.funnel[data.charts.funnel.length - 1];
    return [
      { stage: "Visitors", value: last.visitors },
      { stage: "Leads", value: last.leads },
      { stage: "Bookings", value: last.bookings },
    ];
  }, [data]);

  const campBars = useMemo(() => {
    if (!data) return [];
    return data.charts.campaignPerformance.map((c) => ({
      name: c.name.length > 18 ? c.name.slice(0, 16) + "…" : c.name,
      spend: Number(c.actual_spend) || 0,
      status: c.status,
    }));
  }, [data]);

  if (!dataReady) return null;
  if (loading) return <p style={{ opacity: 0.8 }}>Loading dashboard…</p>;
  if (err) return <p style={{ color: "#b42318" }}>{err}</p>;
  if (!data) return null;

  const k = data.kpis;

  return (
    <div style={{ display: "grid", gap: 28 }}>
      <p style={{ margin: 0, opacity: 0.75, fontSize: 14 }}>
        Month {data.monthRange.start} — {data.monthRange.end}
      </p>

      <section>
        <h2 style={{ fontSize: 16, margin: "0 0 12px", fontWeight: 600 }}>Acquisition</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          <Kpi label="Website visitors (month)" value={String(k.acquisition.websiteVisitors)} />
          <Kpi label="New leads (month)" value={String(k.acquisition.newLeads)} />
          <Kpi
            label="Lead conversion rate"
            value={k.acquisition.leadConversionPct != null ? `${k.acquisition.leadConversionPct}%` : "—"}
          />
          <Kpi label="Cost per lead" value={k.acquisition.costPerLead != null ? `€${k.acquisition.costPerLead}` : "—"} />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 16, margin: "0 0 12px", fontWeight: 600 }}>Conversion</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          <Kpi label="Lead → tenant rate" value={k.conversion.leadToTenantPct != null ? `${k.conversion.leadToTenantPct}%` : "—"} />
          <Kpi label="New tenants (month)" value={String(k.conversion.newTenantsMonth)} />
          <Kpi label="Avg. days to convert" value={k.conversion.avgConvertDays != null ? String(k.conversion.avgConvertDays) : "—"} />
          <Kpi label="Revenue attributed (analytics)" value={`€${Math.round(k.conversion.revenueAttributed)}`} />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 16, margin: "0 0 12px", fontWeight: 600 }}>Campaigns</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          <Kpi label="Active campaigns" value={String(k.campaigns.activeCampaigns)} />
          <Kpi label="Emails sent (month)" value={String(k.campaigns.emailsSentMonth)} />
          <Kpi label="Avg. open rate" value={k.campaigns.avgOpenRatePct != null ? `${k.campaigns.avgOpenRatePct}%` : "—"} />
          <Kpi label="SMS delivery rate" value={k.campaigns.smsDeliveryPct != null ? `${k.campaigns.smsDeliveryPct}%` : "—"} />
        </div>
      </section>

      <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid rgba(26,74,74,0.1)" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Lead funnel</h3>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={funnelAgg}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#1a4a4a" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid rgba(26,74,74,0.1)" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Revenue by channel</h3>
          <div style={{ width: "100%", height: 280 }}>
            {channelData.length === 0 ? (
              <p style={{ padding: 24, opacity: 0.7, fontSize: 14 }}>No channel revenue in marketing_analytics for this month.</p>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={channelData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid rgba(26,74,74,0.1)", gridColumn: "1 / -1" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Campaign spend comparison</h3>
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={campBars} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="spend" fill="#3aafa9" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid rgba(26,74,74,0.1)", gridColumn: "1 / -1" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Revenue trend & marketing events</h3>
          <div style={{ width: "100%", height: 320 }}>
            {data.charts.revenueTrend.length === 0 ? (
              <p style={{ padding: 24, opacity: 0.7, fontSize: 14 }}>No historical revenue rows for your properties yet.</p>
            ) : (
              <ResponsiveContainer>
                <ComposedChart data={data.charts.revenueTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="monthKey" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" name="Revenue (€)" stroke="#1a4a4a" strokeWidth={2} dot={false} />
                  {data.charts.events.map((ev, i) => {
                    const d = new Date(ev.start_datetime);
                    const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
                    if (!data.charts.revenueTrend.some((r) => r.monthKey === mk)) return null;
                    return (
                      <ReferenceLine key={i} x={mk} stroke="#c4a000" strokeDasharray="4 4" label={{ value: ev.name.slice(0, 12), fontSize: 9 }} />
                    );
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
