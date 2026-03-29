"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";

type Campaign = {
  id: string;
  name: string;
  status: string;
  campaign_type: string;
  target_audience: string;
  start_date: string | null;
  end_date: string | null;
  budget: number | null;
  actual_spend: number;
};

export default function MarketingCampaignsPage() {
  const { tenantId, querySuffix, loading: ctxLoading, dataReady, allOrganizations } = useMarketingTenant();
  const [rows, setRows] = useState<Campaign[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!dataReady) return;
    let c = false;
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/marketing/campaigns${querySuffix}`, { cache: "no-store" });
      const j = (await res.json()) as { campaigns?: Campaign[]; error?: string };
      if (!c) {
        if (!res.ok) setErr(j.error ?? "Failed");
        else setRows(j.campaigns ?? []);
        setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [dataReady, querySuffix]);

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault();
    if (allOrganizations || !tenantId || !name.trim()) return;
    setCreating(true);
    const res = await fetch("/api/marketing/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, name: name.trim(), campaign_type: "email", status: "draft" }),
    });
    const j = (await res.json()) as { campaign?: Campaign; error?: string };
    setCreating(false);
    if (!res.ok) {
      setErr(j.error ?? "Failed");
      return;
    }
    if (j.campaign) setRows((r) => [j.campaign!, ...r]);
    setName("");
  }

  if (!dataReady) return null;
  if (loading) return <p>Loading…</p>;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0, flex: 1, fontSize: "1.25rem" }}>Campaigns</h2>
        <Link href={`/marketing/email${querySuffix}`} style={{ color: "var(--petrol, #1a4a4a)" }}>
          Email campaigns →
        </Link>
      </div>
      {err ? <p style={{ color: "#b42318" }}>{err}</p> : null}

      {allOrganizations ? (
        <p style={{ margin: 0, fontSize: 14, color: "rgba(26,74,74,0.8)" }}>
          Select a single organization above to create a campaign.
        </p>
      ) : null}

      <form onSubmit={(e) => void createCampaign(e)} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input
          placeholder="New campaign name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(26,74,74,0.25)", minWidth: 220 }}
        />
        <button
          type="submit"
          disabled={creating || allOrganizations}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: "none",
            background: "var(--petrol, #1a4a4a)",
            color: "#fff",
            cursor: creating ? "wait" : "pointer",
          }}
        >
          Create
        </button>
      </form>

      <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(26,74,74,0.12)" }}>
              <th style={{ padding: 12 }}>Name</th>
              <th style={{ padding: 12 }}>Type</th>
              <th style={{ padding: 12 }}>Status</th>
              <th style={{ padding: 12 }}>Audience</th>
              <th style={{ padding: 12 }}>Spend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid rgba(26,74,74,0.06)" }}>
                <td style={{ padding: 12 }}>{r.name}</td>
                <td style={{ padding: 12 }}>{r.campaign_type}</td>
                <td style={{ padding: 12 }}>{r.status}</td>
                <td style={{ padding: 12 }}>{r.target_audience}</td>
                <td style={{ padding: 12 }}>€{Number(r.actual_spend) || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p style={{ padding: 16, margin: 0, opacity: 0.7 }}>No campaigns yet.</p> : null}
      </div>
    </div>
  );
}
