"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";
import { pathWithMarketingScope } from "@/lib/marketing/access";
import { sanitizeMarketingEmailRow } from "@/lib/marketing/sanitize-marketing-email-row";

type EmailRow = {
  id: string;
  tenant_id: string | null;
  /** Real `marketing_campaigns.id` UUID only — never newsletter/promotional strings. */
  campaign_id: string | null;
  /** newsletter | promotional | transactional | … */
  campaign_type: string | null;
  subject: string;
  status: string;
  recipient_count: number;
  open_count: number;
  click_count: number;
  sent_at: string | null;
  created_at: string;
};

function orgColumnLabel(tenantId: string | null | undefined, tenants: { id: string; name: string }[]): string {
  if (tenantId == null || tenantId === "") return "All";
  return tenants.find((t) => t.id === tenantId)?.name ?? tenantId;
}

function typeLabel(campaignType: string | null | undefined): string {
  if (campaignType?.trim()) return campaignType;
  return "—";
}

export default function MarketingEmailListPage() {
  const { tenants, querySuffix, dataReady } = useMarketingTenant();
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!dataReady) return;
    setLoading(true);
    const res = await fetch(`/api/marketing/emails${querySuffix}`, { cache: "no-store" });
    const j = (await res.json()) as { emails?: EmailRow[]; error?: string };
    if (!res.ok) setErr(j.error ?? "Failed");
    else {
      setErr(null);
      const raw = (j.emails ?? []) as Record<string, unknown>[];
      setRows(raw.map((r) => sanitizeMarketingEmailRow(r) as EmailRow));
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!dataReady) return;
    void load();
  }, [dataReady, querySuffix]);

  async function duplicate(id: string) {
    const res = await fetch(`/api/marketing/emails/${id}/duplicate`, { method: "POST" });
    const j = (await res.json()) as { error?: string };
    if (!res.ok) {
      setErr(j.error ?? "Duplicate failed");
      return;
    }
    void load();
  }

  if (!dataReady) return null;
  if (loading) return <p>Loading…</p>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <h2 style={{ margin: 0, flex: 1, fontSize: "1.25rem" }}>Email campaigns</h2>
        <Link
          href={pathWithMarketingScope("/marketing/email/new", querySuffix)}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            background: "var(--petrol, #1a4a4a)",
            color: "#fff",
            textDecoration: "none",
            fontSize: 14,
          }}
        >
          New email
        </Link>
      </div>
      {err ? <p style={{ color: "#b42318" }}>{err}</p> : null}

      <div style={{ overflowX: "auto", background: "#fff", borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(26,74,74,0.12)" }}>
              <th style={{ padding: 12 }}>Organization</th>
              <th style={{ padding: 12 }}>Type</th>
              <th style={{ padding: 12 }}>Subject</th>
              <th style={{ padding: 12 }}>Status</th>
              <th style={{ padding: 12 }}>Sent</th>
              <th style={{ padding: 12 }}>Open rate</th>
              <th style={{ padding: 12 }}>Click rate</th>
              <th style={{ padding: 12 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rc = Number(r.recipient_count) || 0;
              const oc = Number(r.open_count) || 0;
              const cc = Number(r.click_count) || 0;
              const openRate = rc > 0 ? Math.round((oc / rc) * 1000) / 10 : null;
              const clickRate = rc > 0 ? Math.round((cc / rc) * 1000) / 10 : null;
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid rgba(26,74,74,0.06)" }}>
                  <td style={{ padding: 12 }}>{orgColumnLabel(r.tenant_id, tenants)}</td>
                  <td style={{ padding: 12 }}>{typeLabel(r.campaign_type)}</td>
                  <td style={{ padding: 12 }}>{r.subject || "(no subject)"}</td>
                  <td style={{ padding: 12 }}>{r.status}</td>
                  <td style={{ padding: 12 }}>{r.sent_at ? new Date(r.sent_at).toLocaleString() : "—"}</td>
                  <td style={{ padding: 12 }}>{openRate != null ? `${openRate}%` : "—"}</td>
                  <td style={{ padding: 12 }}>{clickRate != null ? `${clickRate}%` : "—"}</td>
                  <td style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {r.status === "draft" ? (
                      <Link
                        href={pathWithMarketingScope(`/marketing/email/new?id=${encodeURIComponent(r.id)}`, querySuffix)}
                        style={{ fontSize: 13 }}
                      >
                        Edit
                      </Link>
                    ) : null}
                    <button type="button" onClick={() => void duplicate(r.id)} style={{ background: "none", border: "none", color: "var(--petrol)", cursor: "pointer", fontSize: 13, padding: 0 }}>
                      Duplicate
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <p style={{ padding: 16, margin: 0, opacity: 0.7 }}>No emails yet.</p> : null}
      </div>
    </div>
  );
}
