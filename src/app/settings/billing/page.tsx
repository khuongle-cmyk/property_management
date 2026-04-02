"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/date/format";

type SummaryResp = {
  tenant?: { id: string; name: string; plan: string; trial_status?: string; trial_ends_at?: string | null };
  breakdown?: {
    billingMonth: string;
    lineItems: Array<{ label: string; qty: number; unitPrice: number; amount: number }>;
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    trialCreditAmount: number;
    inTrial: boolean;
  };
  openTotal?: number;
  invoices?: Array<{ id: string; invoice_number: string; billing_month: string; due_date: string; status: string; total_amount: number }>;
  stripe?: { enabled: boolean; status: string };
  error?: string;
};

export default function BillingSettingsPage() {
  const [data, setData] = useState<SummaryResp>({});
  const [msg, setMsg] = useState<string | null>(null);
  const billingMonth = useMemo(() => new Date().toISOString().slice(0, 7) + "-01", []);

  async function load() {
    const r = await fetch("/api/billing/tenant/summary");
    const j = (await r.json()) as SummaryResp;
    if (!r.ok) {
      setMsg(j.error ?? "Failed to load billing");
      return;
    }
    setData(j);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createInvoice(send: boolean) {
    setMsg(null);
    const r = await fetch("/api/billing/tenant/invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: data.tenant?.id,
        billingMonth,
        action: send ? "send" : "create",
      }),
    });
    const j = (await r.json()) as { error?: string };
    if (!r.ok) {
      setMsg(j.error ?? "Could not create invoice");
      return;
    }
    setMsg(send ? "Invoice created and sent." : "Draft invoice created.");
    await load();
  }

  return (
    <main style={{ display: "grid", gap: 12 }}>
      <h1 className="vw-admin-page-title" style={{ margin: 0 }}>Organization billing</h1>
      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 12, display: "grid", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>What you owe and why</h2>
        <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
          Plan: <strong>{data.tenant?.plan ?? "—"}</strong> · Outstanding: <strong>EUR {(data.openTotal ?? 0).toFixed(2)}</strong>
        </p>
        {data.tenant?.trial_status === "active" ? (
          <p style={{ margin: 0, color: "#065f46", fontSize: 13 }}>
            Trial active until {data.tenant?.trial_ends_at ? formatDate(data.tenant.trial_ends_at) : "—"}
          </p>
        ) : null}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Line item", "Qty", "Unit", "Amount"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data.breakdown?.lineItems ?? []).map((x, i) => (
              <tr key={i}>
                <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{x.label}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{x.qty}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>EUR {x.unitPrice.toFixed(2)}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>EUR {x.amount.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ margin: 0, fontSize: 13 }}>
          Subtotal EUR {(data.breakdown?.subtotal ?? 0).toFixed(2)} · VAT EUR {(data.breakdown?.taxAmount ?? 0).toFixed(2)} ·
          Total <strong>EUR {(data.breakdown?.totalAmount ?? 0).toFixed(2)}</strong>
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void createInvoice(false)}>Generate draft invoice</button>
          <button type="button" onClick={() => void createInvoice(true)}>Generate and send invoice</button>
          <button type="button" disabled title="Stripe billing coming soon">
            Stripe automatic billing (Coming soon)
          </button>
        </div>
        {msg ? <p style={{ margin: 0, color: "#1e3a8a" }}>{msg}</p> : null}
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Manual invoices</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Invoice", "Month", "Due", "Status", "Total"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data.invoices ?? []).map((i) => (
              <tr key={i.id}>
                <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{i.invoice_number}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{i.billing_month.slice(0, 7)}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{i.due_date}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{i.status}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>EUR {Number(i.total_amount ?? 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

