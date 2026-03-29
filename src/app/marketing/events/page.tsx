"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";
import { pathWithMarketingScope } from "@/lib/marketing/access";

type Ev = {
  id: string;
  slug: string;
  name: string;
  status: string;
  start_datetime: string;
  is_public: boolean;
  _registration_count?: number;
};

export default function MarketingEventsPage() {
  const { querySuffix, dataReady } = useMarketingTenant();
  const [rows, setRows] = useState<Ev[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!dataReady) return;
    let c = false;
    void (async () => {
      const res = await fetch(`/api/marketing/events${querySuffix}`, { cache: "no-store" });
      const j = (await res.json()) as { events?: Ev[]; error?: string };
      if (!c) {
        if (!res.ok) setErr(j.error ?? "Failed");
        else setRows(j.events ?? []);
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
        <h2 style={{ margin: 0, flex: 1, fontSize: "1.25rem" }}>Events</h2>
        <Link
          href={pathWithMarketingScope("/marketing/events/new", querySuffix)}
          style={{ padding: "10px 16px", borderRadius: 8, background: "var(--petrol)", color: "#fff", textDecoration: "none" }}
        >
          New event
        </Link>
      </div>
      {err ? <p style={{ color: "#b42318" }}>{err}</p> : null}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(26,74,74,0.12)" }}>
              <th style={{ padding: 12 }}>Name</th>
              <th style={{ padding: 12 }}>When</th>
              <th style={{ padding: 12 }}>Status</th>
              <th style={{ padding: 12 }}>Registrations</th>
              <th style={{ padding: 12 }}>Public link</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid rgba(26,74,74,0.06)" }}>
                <td style={{ padding: 12 }}>
                  <Link href={pathWithMarketingScope(`/marketing/events/${r.id}`, querySuffix)}>{r.name}</Link>
                </td>
                <td style={{ padding: 12 }}>{new Date(r.start_datetime).toLocaleString()}</td>
                <td style={{ padding: 12 }}>{r.status}</td>
                <td style={{ padding: 12 }}>{r._registration_count ?? 0}</td>
                <td style={{ padding: 12 }}>
                  {r.is_public && r.status === "published" ? (
                    <a href={`/events/${r.slug}`} target="_blank" rel="noreferrer">
                      /events/{r.slug}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p style={{ padding: 16 }}>No events.</p> : null}
      </div>
    </div>
  );
}
