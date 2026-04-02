"use client";

import { useEffect, useState } from "react";

type BillingSummary = {
  tenants?: Array<{ id: string; name: string; plan: string; trial_status: string; outstanding_total: number }>;
  plans?: Array<{
    id: string;
    display_name: string;
    monthly_base_fee: number;
    included_properties: number;
    per_property_fee: number;
    included_users: number;
    per_user_fee: number;
    trial_days: number;
    is_active: boolean;
  }>;
  error?: string;
};

export default function SuperAdminBillingPage() {
  const [data, setData] = useState<BillingSummary>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [calcTenantId, setCalcTenantId] = useState("");
  const [calc, setCalc] = useState<{ tenant?: { name?: string }; breakdown?: { totalAmount: number; subtotal: number; taxAmount: number; lineItems: Array<{ label: string; amount: number }> }; error?: string }>({});

  async function load() {
    const r = await fetch("/api/super-admin/billing/summary");
    const j = (await r.json()) as BillingSummary;
    if (!r.ok) {
      setMsg(j.error ?? "Failed to load billing dashboard");
      return;
    }
    setData(j);
  }

  useEffect(() => {
    void load();
  }, []);

  async function runCalculator() {
    if (!calcTenantId) return;
    const r = await fetch("/api/billing/calculator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: calcTenantId }),
    });
    const j = (await r.json()) as typeof calc;
    setCalc(j);
  }

  async function savePlan(plan: {
    id: string;
    display_name: string;
    monthly_base_fee: number;
    included_properties: number;
    per_property_fee: number;
    included_users: number;
    per_user_fee: number;
    trial_days: number;
    is_active: boolean;
  }) {
    const r = await fetch("/api/billing/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan),
    });
    const j = (await r.json()) as { error?: string };
    if (!r.ok) {
      setMsg(j.error ?? "Could not save plan");
      return;
    }
    setMsg("Plan updated.");
    await load();
  }

  return (
    <main style={{ display: "grid", gap: 12 }}>
      <h1 className="vw-admin-page-title" style={{ margin: 0 }}>Super admin billing</h1>
      {msg ? <p style={{ margin: 0, color: "#1e3a8a" }}>{msg}</p> : null}

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Organization billing dashboard</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Organization", "Plan", "Trial", "Outstanding"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data.tenants ?? []).map((t) => (
              <tr key={t.id}>
                <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{t.name}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{t.plan}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{t.trial_status}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>EUR {Number(t.outstanding_total ?? 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Pricing plans management</h2>
        <div style={{ display: "grid", gap: 10 }}>
          {(data.plans ?? []).map((p) => (
            <div key={p.id} style={{ border: "1px solid #eef2f7", borderRadius: 10, padding: 10, display: "grid", gap: 8 }}>
              <strong>{p.display_name}</strong>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(120px,1fr))", gap: 8 }}>
                <label>Base EUR <input defaultValue={p.monthly_base_fee} onBlur={(e) => void savePlan({ ...p, monthly_base_fee: Number(e.target.value) })} /></label>
                <label>Included properties <input defaultValue={p.included_properties} onBlur={(e) => void savePlan({ ...p, included_properties: Number(e.target.value) })} /></label>
                <label>Per property EUR <input defaultValue={p.per_property_fee} onBlur={(e) => void savePlan({ ...p, per_property_fee: Number(e.target.value) })} /></label>
                <label>Trial days <input defaultValue={p.trial_days} onBlur={(e) => void savePlan({ ...p, trial_days: Number(e.target.value) })} /></label>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <button type="button" disabled title="Coming soon">Stripe automatic billing (Coming soon)</button>
        </div>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 12, display: "grid", gap: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Pricing calculator</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={calcTenantId} onChange={(e) => setCalcTenantId(e.target.value)}>
            <option value="">Select organization…</option>
            {(data.tenants ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button type="button" onClick={() => void runCalculator()} disabled={!calcTenantId}>
            Calculate
          </button>
        </div>
        {calc.breakdown ? (
          <div>
            <p style={{ margin: "4px 0" }}>
              Subtotal EUR {calc.breakdown.subtotal.toFixed(2)} · VAT EUR {calc.breakdown.taxAmount.toFixed(2)} ·
              Total <strong>EUR {calc.breakdown.totalAmount.toFixed(2)}</strong>
            </p>
            <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
              {calc.breakdown.lineItems.map((l, i) => (
                <li key={i}>{l.label}: EUR {l.amount.toFixed(2)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </main>
  );
}

