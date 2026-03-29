"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";
import { pathWithMarketingScope } from "@/lib/marketing/access";

type SmsRow = {
  id: string;
  message_text: string;
  status: string;
  recipient_count: number;
  delivered_count: number;
  failed_count: number;
  sent_at: string | null;
};

export default function MarketingSmsPage() {
  const { querySuffix, dataReady } = useMarketingTenant();
  const [rows, setRows] = useState<SmsRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!dataReady) return;
    let c = false;
    void (async () => {
      const res = await fetch(`/api/marketing/sms${querySuffix}`, { cache: "no-store" });
      const j = (await res.json()) as { sms?: SmsRow[]; error?: string };
      if (!c) {
        if (!res.ok) setErr(j.error ?? "Failed");
        else setRows(j.sms ?? []);
      }
    })();
    return () => {
      c = true;
    };
  }, [dataReady, querySuffix]);

  if (!dataReady) return null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <h2 style={{ margin: 0, flex: 1, fontSize: "1.25rem" }}>SMS campaigns</h2>
        <Link
          href={pathWithMarketingScope("/marketing/sms/new", querySuffix)}
          style={{ padding: "10px 16px", borderRadius: 8, background: "var(--petrol)", color: "#fff", textDecoration: "none" }}
        >
          New SMS
        </Link>
      </div>
      <p style={{ fontSize: 14, opacity: 0.8, margin: 0 }}>
        Requires <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, <code>TWILIO_FROM_NUMBER</code>. Opt-out text is appended automatically.
      </p>
      {err ? <p style={{ color: "#b42318" }}>{err}</p> : null}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(26,74,74,0.12)" }}>
              <th style={{ padding: 12 }}>Message</th>
              <th style={{ padding: 12 }}>Status</th>
              <th style={{ padding: 12 }}>Recipients</th>
              <th style={{ padding: 12 }}>Delivered</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid rgba(26,74,74,0.06)" }}>
                <td style={{ padding: 12, maxWidth: 320 }}>{r.message_text.slice(0, 120)}{r.message_text.length > 120 ? "…" : ""}</td>
                <td style={{ padding: 12 }}>{r.status}</td>
                <td style={{ padding: 12 }}>{r.recipient_count}</td>
                <td style={{ padding: 12 }}>{r.delivered_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p style={{ padding: 16 }}>No SMS campaigns.</p> : null}
      </div>
    </div>
  );
}
