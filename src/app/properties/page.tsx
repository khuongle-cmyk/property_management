"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { loadScopedPropertiesForUser, type ScopedPropertyRow } from "@/lib/properties/scoped";

function formatAddress(p: ScopedPropertyRow): string {
  const parts = [p.address, [p.postal_code, p.city].filter(Boolean).join(" ")].filter(
    (x) => x && String(x).trim() !== "",
  );
  return parts.length ? parts.join(", ") : "—";
}

function occupancyLabel(p: ScopedPropertyRow): string {
  const total = p.total_units ?? null;
  const occ = p.occupied_units ?? null;
  if (total == null || occ == null || total <= 0) return "—";
  const pct = Math.round((100 * occ) / total);
  return `${pct}% (${occ}/${total})`;
}

function tenantOrgName(p: ScopedPropertyRow): string {
  const t = p.tenants;
  if (t == null) return "—";
  if (Array.isArray(t)) return t[0]?.name ?? "—";
  return t.name ?? "—";
}

function statusStyle(status: string | null | undefined): { label: string; bg: string; color: string } {
  const s = (status ?? "").toLowerCase();
  if (s === "active") return { label: "Active", bg: "#e8f5e9", color: "#1b5e20" };
  if (s === "inactive") return { label: "Inactive", bg: "#fce4ec", color: "#880e4f" };
  if (s === "under_renovation") return { label: "Under renovation", bg: "#fff3e0", color: "#e65100" };
  return { label: status?.replace(/_/g, " ") || "—", bg: "#f1f5f9", color: "#475569" };
}

export default function PropertiesListPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ScopedPropertyRow[]>([]);

  const load = useCallback(async () => {
    const supabase = getSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }
    setError(null);
    const scoped = await loadScopedPropertiesForUser(supabase, user.id);
    setRows(scoped.properties ?? []);
  }, [router]);

  useEffect(() => {
    let c = false;
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (e) {
        if (!c) setError(e instanceof Error ? e.message : "Failed to load properties");
      }
      if (!c) setLoading(false);
    })();
    return () => {
      c = true;
    };
  }, [load]);

  const sorted = useMemo(() => [...rows].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")), [rows]);

  if (loading) return <p style={{ padding: 24, color: "#64748b" }}>Loading…</p>;
  if (error) {
    return (
      <main style={{ padding: 24, maxWidth: 1100 }}>
        <p style={{ color: "#b00020" }}>{error}</p>
        <Link href="/dashboard">Dashboard</Link>
      </main>
    );
  }

  return (
    <main style={{ padding: "24px 28px", maxWidth: 1200 }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 26, fontWeight: 600 }}>Properties</h1>
      <p style={{ margin: "0 0 24px", color: "#64748b", maxWidth: 640 }}>
        Buildings and sites you can access. Open rooms, operating costs, or financial reports for each property.
      </p>

      {sorted.length === 0 ? (
        <p style={{ color: "#64748b" }}>No properties found for your account.</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                <th style={{ padding: "12px 14px", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>Name</th>
                <th style={{ padding: "12px 14px", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>Address</th>
                <th style={{ padding: "12px 14px", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>Organization</th>
                <th style={{ padding: "12px 14px", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>Occupancy</th>
                <th style={{ padding: "12px 14px", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>Status</th>
                <th style={{ padding: "12px 14px", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>Links</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const org = tenantOrgName(p);
                const st = statusStyle(p.status);
                return (
                  <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "12px 14px", fontWeight: 500 }}>{p.name ?? "—"}</td>
                    <td style={{ padding: "12px 14px", color: "#475569", maxWidth: 280 }}>{formatAddress(p)}</td>
                    <td style={{ padding: "12px 14px", color: "#475569" }}>{org}</td>
                    <td style={{ padding: "12px 14px" }}>{occupancyLabel(p)}</td>
                    <td style={{ padding: "12px 14px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 10px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 500,
                          background: st.bg,
                          color: st.color,
                        }}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <Link href={`/rooms?propertyId=${encodeURIComponent(p.id)}`} style={{ color: "#0f766e" }}>
                          Rooms
                        </Link>
                        <Link href={`/properties/${p.id}`} style={{ color: "#0f766e" }}>
                          Costs
                        </Link>
                        <Link href={`/reports/rent-roll?propertyId=${encodeURIComponent(p.id)}`} style={{ color: "#0f766e" }}>
                          Rent roll
                        </Link>
                        <Link href={`/reports/net-income?propertyId=${encodeURIComponent(p.id)}`} style={{ color: "#0f766e" }}>
                          Net income
                        </Link>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
