"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import LeadFunnel from "@/components/marketing/LeadFunnel";
import MetricCard from "@/components/marketing/MetricCard";
import RevenueByChannel from "@/components/marketing/RevenueByChannel";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";

type DashboardJson = {
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

function initialMonthYyyyMm(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function dashboardFetchUrl(querySuffix: string, month: string): string {
  const base = "/api/marketing/dashboard";
  const params = new URLSearchParams();
  if (querySuffix.startsWith("?")) {
    const inner = new URLSearchParams(querySuffix.slice(1));
    inner.forEach((v, k) => params.set(k, v));
  }
  params.set("month", month);
  return `${base}?${params.toString()}`;
}

function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const periodInputStyle: CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: "8px",
  padding: "8px 12px",
  backgroundColor: "#fff",
  color: "#111827",
  fontSize: "14px",
};

export default function MarketingDashboardPage() {
  const { querySuffix, dataReady } = useMarketingTenant();
  const [selectedPeriod, setSelectedPeriod] = useState(initialMonthYyyyMm);
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
        const res = await fetch(dashboardFetchUrl(querySuffix, selectedPeriod), { cache: "no-store" });
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
  }, [dataReady, querySuffix, selectedPeriod]);

  const funnelLast = useMemo(() => {
    if (!data?.charts.funnel.length) return null;
    return data.charts.funnel[data.charts.funnel.length - 1];
  }, [data]);

  const [year, month] = selectedPeriod.split("-").map(Number);
  const periodStart = new Date(year, month - 1, 1);
  const periodEnd = new Date(year, month, 0);

  if (!dataReady) return null;

  if (loading && !data) {
    return (
      <div>
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-500">Period</span>
          <input
            type="month"
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            style={periodInputStyle}
          />
        </div>
        <p className="text-sm text-gray-500">Loading dashboard…</p>
      </div>
    );
  }

  if (err) {
    return <p className="text-sm text-red-700">{err}</p>;
  }

  if (!data) return null;

  const k = data.kpis;
  const visitors = funnelLast?.visitors ?? k.acquisition.websiteVisitors;
  const leads = funnelLast?.leads ?? k.acquisition.newLeads;
  const tours = funnelLast?.bookings ?? 0;
  const tenants = k.conversion.newTenantsMonth;

  return (
    <div>
      {/* Period selector */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-500">Period</span>
        <input
          type="month"
          value={selectedPeriod}
          onChange={(e) => setSelectedPeriod(e.target.value)}
          style={periodInputStyle}
        />
        <span className="text-xs text-gray-400">{formatLocalYmd(periodStart)} — {formatLocalYmd(periodEnd)}</span>
      </div>

      {/* Acquisition metrics */}
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Acquisition</h2>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Website visitors (month)" value={String(k.acquisition.websiteVisitors)} />
        <MetricCard label="New leads (month)" value={String(k.acquisition.newLeads)} />
        <MetricCard
          label="Lead conversion rate"
          value={k.acquisition.leadConversionPct != null ? `${k.acquisition.leadConversionPct}%` : "—"}
          muted={k.acquisition.leadConversionPct == null}
        />
        <MetricCard
          label="Cost per lead"
          value={k.acquisition.costPerLead != null ? `€${k.acquisition.costPerLead}` : "—"}
          muted={k.acquisition.costPerLead == null}
        />
      </div>

      {/* Conversion metrics */}
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Conversion</h2>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Lead → tenant rate"
          value={k.conversion.leadToTenantPct != null ? `${k.conversion.leadToTenantPct}%` : "—"}
          muted={k.conversion.leadToTenantPct == null}
        />
        <MetricCard label="New tenants (month)" value={String(k.conversion.newTenantsMonth)} />
        <MetricCard
          label="Avg. days to convert"
          value={k.conversion.avgConvertDays != null ? String(k.conversion.avgConvertDays) : "—"}
          muted={k.conversion.avgConvertDays == null}
        />
        <MetricCard label="Revenue attributed" value={`€${Math.round(k.conversion.revenueAttributed).toLocaleString()}`} />
      </div>

      {/* Campaign metrics */}
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Campaigns</h2>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Active campaigns" value={String(k.campaigns.activeCampaigns)} />
        <MetricCard label="Emails sent (month)" value={String(k.campaigns.emailsSentMonth)} />
        <MetricCard
          label="Avg. open rate"
          value={k.campaigns.avgOpenRatePct != null ? `${k.campaigns.avgOpenRatePct}%` : "—"}
          muted={k.campaigns.avgOpenRatePct == null}
        />
        <MetricCard
          label="SMS delivery rate"
          value={k.campaigns.smsDeliveryPct != null ? `${k.campaigns.smsDeliveryPct}%` : "—"}
          muted={k.campaigns.smsDeliveryPct == null}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LeadFunnel visitors={visitors} leads={leads} tours={tours} tenants={tenants} />
        <RevenueByChannel channels={data.charts.revenueByChannel} monthKey={selectedPeriod} />
      </div>
    </div>
  );
}
