"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";

type Row = {
  date: string;
  source: string;
  website_visitors: number;
  new_leads: number;
  ad_spend: number;
  revenue_attributed: number;
};

export default function MarketingAnalyticsPage() {
  const { querySuffix, dataReady } = useMarketingTenant();
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!dataReady) return;
    let c = false;
    void (async () => {
      const res = await fetch(`/api/marketing/analytics-data${querySuffix}`, { cache: "no-store" });
      const j = (await res.json()) as { rows?: Row[]; error?: string };
      if (!c) {
        if (!res.ok) setErr(j.error ?? "Failed");
        else setRows(j.rows ?? []);
      }
    })();
    return () => {
      c = true;
    };
  }, [dataReady, querySuffix]);

  const bySource = useMemo(() => {
    const m = new Map<string, { source: string; leads: number; spend: number; revenue: number }>();
    for (const r of rows) {
      const cur = m.get(r.source) ?? { source: r.source, leads: 0, spend: 0, revenue: 0 };
      cur.leads += Number(r.new_leads) || 0;
      cur.spend += Number(r.ad_spend) || 0;
      cur.revenue += Number(r.revenue_attributed) || 0;
      m.set(r.source, cur);
    }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  }, [rows]);

  if (!dataReady) return null;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Marketing analytics</h2>
      <p style={{ margin: 0, fontSize: 14, opacity: 0.85 }}>
        Daily rows per channel in <code>marketing_analytics</code>. GA4, Google Ads, and Meta connectors can populate this table via scheduled jobs.
      </p>
      {err ? <p style={{ color: "#b42318" }}>{err}</p> : null}

      <div style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid rgba(26,74,74,0.1)" }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Leads & spend by source (rollup)</h3>
        <div style={{ width: "100%", height: 320 }}>
          {bySource.length === 0 ? (
            <p style={{ opacity: 0.7 }}>No analytics rows yet.</p>
          ) : (
            <ResponsiveContainer>
              <BarChart data={bySource}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="source" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="leads" fill="#1a4a4a" name="Leads" />
                <Bar dataKey="spend" fill="#c4a000" name="Ad spend (€)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(26,74,74,0.12)" }}>
              <th style={{ padding: 10 }}>Date</th>
              <th style={{ padding: 10 }}>Source</th>
              <th style={{ padding: 10 }}>Visitors</th>
              <th style={{ padding: 10 }}>Leads</th>
              <th style={{ padding: 10 }}>Spend</th>
              <th style={{ padding: 10 }}>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 80).map((r) => (
              <tr key={`${r.date}-${r.source}`} style={{ borderBottom: "1px solid rgba(26,74,74,0.06)" }}>
                <td style={{ padding: 10 }}>{r.date}</td>
                <td style={{ padding: 10 }}>{r.source}</td>
                <td style={{ padding: 10 }}>{r.website_visitors}</td>
                <td style={{ padding: 10 }}>{r.new_leads}</td>
                <td style={{ padding: 10 }}>{r.ad_spend}</td>
                <td style={{ padding: 10 }}>{r.revenue_attributed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
