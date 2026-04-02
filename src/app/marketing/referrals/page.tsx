"use client";

import { useEffect, useState } from "react";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";

type Ref = {
  id: string;
  tenant_id: string | null;
  referral_code: string;
  status: string;
  reward_type: string | null;
  reward_amount: number | null;
  created_at: string;
};

function orgColumnLabel(tenantId: string | null | undefined, tenants: { id: string; name: string }[]): string {
  if (tenantId == null || tenantId === "") return "All";
  return tenants.find((t) => t.id === tenantId)?.name ?? tenantId;
}

export default function MarketingReferralsPage() {
  const { tenantId, tenants, querySuffix, dataReady, allOrganizations } = useMarketingTenant();
  const [rows, setRows] = useState<Ref[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dataReady) return;
    let c = false;
    void (async () => {
      const res = await fetch(`/api/marketing/referrals${querySuffix}`, { cache: "no-store" });
      const j = (await res.json()) as { referrals?: Ref[]; error?: string };
      if (!c) {
        if (!res.ok) setErr(j.error ?? "Failed");
        else setRows(j.referrals ?? []);
      }
    })();
    return () => {
      c = true;
    };
  }, [dataReady, querySuffix]);

  async function addRow() {
    if (!dataReady) return;
    if (!allOrganizations && !tenantId) return;
    setBusy(true);
    const payload: Record<string, unknown> = {
      referral_code: code.trim() || undefined,
      status: "pending",
      reward_type: "discount",
      reward_amount: 100,
    };
    if (allOrganizations) payload.allOrganizations = true;
    else payload.tenantId = tenantId;
    const res = await fetch("/api/marketing/referrals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = (await res.json()) as { referral?: Ref; error?: string };
    setBusy(false);
    if (!res.ok) setErr(j.error ?? "Failed");
    else {
      setCode("");
      if (j.referral) setRows((r) => [j.referral!, ...r]);
    }
  }

  if (!dataReady) return null;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Referrals</h2>
      <p style={{ margin: 0, fontSize: 14, opacity: 0.85 }}>
        Track referral codes; unique links per tenant in the portal and automatic rewards on contract signed can be layered on this table.
      </p>
      {err ? <p style={{ color: "#b42318" }}>{err}</p> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="Custom code (optional)" value={code} onChange={(e) => setCode(e.target.value)} style={inp} />
        <button
          type="button"
          onClick={() => void addRow()}
          disabled={busy || allOrganizations}
          style={{ padding: "10px 16px", borderRadius: 8, background: "var(--petrol)", color: "#fff", border: "none", cursor: "pointer" }}
        >
          Add tracking row
        </button>
      </div>
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(26,74,74,0.12)" }}>
              <th style={{ padding: 12 }}>Organization</th>
              <th style={{ padding: 12 }}>Code</th>
              <th style={{ padding: 12 }}>Status</th>
              <th style={{ padding: 12 }}>Reward</th>
              <th style={{ padding: 12 }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid rgba(26,74,74,0.06)" }}>
                <td style={{ padding: 12 }}>{orgColumnLabel(r.tenant_id, tenants)}</td>
                <td style={{ padding: 12 }}>{r.referral_code}</td>
                <td style={{ padding: 12 }}>{r.status}</td>
                <td style={{ padding: 12 }}>
                  {r.reward_type ?? "—"} {r.reward_amount != null ? `€${r.reward_amount}` : ""}
                </td>
                <td style={{ padding: 12 }}>{new Date(r.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p style={{ padding: 16 }}>No referrals logged.</p> : null}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { padding: 10, borderRadius: 8, border: "1px solid rgba(26,74,74,0.25)", minWidth: 200 };
