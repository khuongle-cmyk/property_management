"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";
import { pathWithMarketingScope } from "@/lib/marketing/access";

type Reg = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  status: string;
  registered_at: string;
  checked_in_at: string | null;
};

type Ev = { id: string; slug: string; name: string; status: string; is_public: boolean };

export default function EventDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const { loading: ctxLoading, querySuffix } = useMarketingTenant();
  const [ev, setEv] = useState<Ev | null>(null);
  const [regs, setRegs] = useState<Reg[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/marketing/events/${id}`, { cache: "no-store" });
    const j = (await res.json()) as { event?: Ev; registrations?: Reg[]; error?: string };
    if (!res.ok) setErr(j.error ?? "Failed");
    else {
      setEv(j.event ?? null);
      setRegs(j.registrations ?? []);
    }
  }

  useEffect(() => {
    if (ctxLoading || !id) return;
    void load();
  }, [id, ctxLoading]);

  async function checkIn(regId: string) {
    const res = await fetch(`/api/marketing/events/registrations/${regId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checked_in: true }),
    });
    if (res.ok) void load();
  }

  function exportXlsx() {
    const ws = XLSX.utils.json_to_sheet(
      regs.map((r) => ({
        Name: r.name,
        Email: r.email,
        Company: r.company ?? "",
        Status: r.status,
        Registered: r.registered_at,
        CheckedIn: r.checked_in_at ?? "",
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendees");
    XLSX.writeFile(wb, `event-${ev?.slug ?? id}-attendees.xlsx`);
  }

  if (ctxLoading) return null;
  if (err) return <p style={{ color: "#b42318" }}>{err}</p>;
  if (!ev) return <p>Loading…</p>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Link href={pathWithMarketingScope("/marketing/events", querySuffix)}>← Events</Link>
      <h2 style={{ margin: 0 }}>{ev.name}</h2>
      <p style={{ margin: 0, fontSize: 14 }}>
        Status: {ev.status}
        {ev.is_public && ev.status === "published" ? (
          <>
            {" "}
            · <a href={`/events/${ev.slug}`}>Public page</a>
          </>
        ) : null}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => exportXlsx()} style={{ padding: "8px 14px", borderRadius: 8, cursor: "pointer" }}>
          Export Excel
        </button>
      </div>
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(26,74,74,0.12)" }}>
              <th style={{ padding: 12 }}>Name</th>
              <th style={{ padding: 12 }}>Email</th>
              <th style={{ padding: 12 }}>Status</th>
              <th style={{ padding: 12 }}>Check-in</th>
            </tr>
          </thead>
          <tbody>
            {regs.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid rgba(26,74,74,0.06)" }}>
                <td style={{ padding: 12 }}>{r.name}</td>
                <td style={{ padding: 12 }}>{r.email}</td>
                <td style={{ padding: 12 }}>{r.status}</td>
                <td style={{ padding: 12 }}>
                  {r.checked_in_at ? (
                    new Date(r.checked_in_at).toLocaleString()
                  ) : (
                    <button type="button" onClick={() => void checkIn(r.id)} style={{ fontSize: 13, cursor: "pointer" }}>
                      Check in
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {regs.length === 0 ? <p style={{ padding: 16 }}>No registrations.</p> : null}
      </div>
    </div>
  );
}
