"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";

type TenantOpt = { id: string; name: string | null };
type PropertyOpt = { id: string; name: string | null };
type FeeRow = {
  id: string;
  tenant_id: string;
  property_id: string | null;
  year: number;
  month: number;
  amount_eur: number;
  calculation_notes?: string | null;
};

type Props = {
  dateRange: { start: string; end: string };
};

const inputStyle: CSSProperties = { padding: 8, borderRadius: 8, border: "1px solid #ccc", width: "100%" };
const btn: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
};
const btnGhost: CSSProperties = { ...btn, background: "#fff", color: "#111" };

export function AdminFeeSettingsPanel({ dateRange }: Props) {
  const [tenants, setTenants] = useState<TenantOpt[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [properties, setProperties] = useState<PropertyOpt[]>([]);
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [month, setMonth] = useState(new Date().getUTCMonth() + 1);
  const [amount, setAmount] = useState("");
  const [propertyId, setPropertyId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/super-admin/brands-tenants");
        const json = (await res.json()) as { tenants?: TenantOpt[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to load tenants");
        if (cancelled) return;
        setTenants(json.tenants ?? []);
        if ((json.tenants?.length ?? 0) > 0) setTenantId(json.tenants![0].id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadProperties = useCallback(async (tid: string) => {
    if (!tid) {
      setProperties([]);
      return;
    }
    const supabase = getSupabaseClient();
    const { data, error: pErr } = await supabase
      .from("properties")
      .select("id, name")
      .eq("tenant_id", tid)
      .order("name", { ascending: true });
    if (pErr) {
      setError(pErr.message);
      setProperties([]);
      return;
    }
    setProperties((data ?? []) as PropertyOpt[]);
  }, []);

  const loadFees = useCallback(async () => {
    if (!tenantId) return;
    setListLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        tenantId,
        startDate: dateRange.start,
        endDate: dateRange.end,
      });
      const res = await fetch(`/api/platform-management-fees?${q.toString()}`);
      const json = (await res.json()) as { fees?: FeeRow[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load fees");
      setFees(json.fees ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fees");
    } finally {
      setListLoading(false);
    }
  }, [tenantId, dateRange.start, dateRange.end]);

  useEffect(() => {
    void loadProperties(tenantId);
  }, [tenantId, loadProperties]);

  useEffect(() => {
    if (tenantId) void loadFees();
  }, [tenantId, loadFees]);

  const resetForm = () => {
    setEditingId(null);
    setPropertyId("");
    setNotes("");
    setAmount("");
    setYear(new Date().getUTCFullYear());
    setMonth(new Date().getUTCMonth() + 1);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      setError("Enter a valid amount (≥ 0).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        const res = await fetch(`/api/platform-management-fees/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            property_id: propertyId || null,
            year,
            month,
            amount_eur: amt,
            calculation_notes: notes.trim() || null,
          }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Save failed");
      } else {
        const res = await fetch("/api/platform-management-fees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant_id: tenantId,
            property_id: propertyId || null,
            year,
            month,
            amount_eur: amt,
            calculation_notes: notes.trim() || null,
          }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Create failed");
      }
      resetForm();
      await loadFees();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (f: FeeRow) => {
    setEditingId(f.id);
    setPropertyId(f.property_id ?? "");
    setYear(f.year);
    setMonth(f.month);
    setAmount(String(f.amount_eur));
    setNotes(f.calculation_notes ?? "");
  };

  const onDelete = async (id: string) => {
    if (!globalThis.confirm("Delete this fee line?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/platform-management-fees/${id}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Delete failed");
      if (editingId === id) resetForm();
      await loadFees();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  if (loading) return <p style={{ color: "#666", fontSize: 14 }}>Loading platform fee settings…</p>;

  return (
    <section
      className="no-print"
      style={{
        marginTop: 24,
        padding: 16,
        border: "1px solid #e0e0e0",
        borderRadius: 12,
        background: "#fafafa",
        maxWidth: 720,
      }}
    >
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Platform management fees (super admin)</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#555" }}>
        Set fees per organization. Leave property empty for a portfolio-wide fee (allocated by revenue share in the net
        income report). Tenants see amounts only — not your internal notes.
      </p>

      {error ? (
        <p style={{ color: "#b00020", fontSize: 13, marginBottom: 10 }}>{error}</p>
      ) : null}

      <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span>Organization</span>
          <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={inputStyle}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name ?? t.id}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ overflowX: "auto", marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={th}>Scope</th>
              <th style={th}>Month</th>
              <th style={thR}>Amount</th>
              <th style={th}>Notes (internal)</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {listLoading ? (
              <tr>
                <td colSpan={5} style={td}>
                  Loading…
                </td>
              </tr>
            ) : fees.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...td, color: "#666" }}>
                  No fee lines in this date range.
                </td>
              </tr>
            ) : (
              fees.map((f) => {
                const propName = f.property_id ? properties.find((p) => p.id === f.property_id)?.name : null;
                const scope = f.property_id ? (propName ?? f.property_id) : "Portfolio (all properties)";
                return (
                  <tr key={f.id}>
                    <td style={td}>{scope}</td>
                    <td style={td}>
                      {f.year}-{String(f.month).padStart(2, "0")}
                    </td>
                    <td style={tdR}>
                      {new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(f.amount_eur)}
                    </td>
                    <td style={{ ...td, maxWidth: 200, wordBreak: "break-word" }}>{f.calculation_notes ?? "—"}</td>
                    <td style={td}>
                      <button type="button" onClick={() => onEdit(f)} style={{ ...btnGhost, padding: "4px 8px", fontSize: 12 }}>
                        Edit
                      </button>{" "}
                      <button
                        type="button"
                        onClick={() => void onDelete(f.id)}
                        style={{
                          ...btnGhost,
                          padding: "4px 8px",
                          fontSize: 12,
                          borderColor: "#c00",
                          color: "#c00",
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} style={{ display: "grid", gap: 10 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{editingId ? "Edit fee line" : "Add fee line"}</p>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span>Property (optional — empty = portfolio-wide)</span>
          <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} style={inputStyle}>
            <option value="">— Portfolio-wide —</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.id}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span>Year</span>
            <input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span>Month</span>
            <input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span>Amount (EUR)</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              style={inputStyle}
            />
          </label>
        </div>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span>Calculation notes (super admin only — not shown to tenants)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="submit" disabled={saving} style={btn}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Add fee"}
          </button>
          {editingId ? (
            <button type="button" onClick={resetForm} style={btnGhost}>
              Cancel edit
            </button>
          ) : null}
          <button type="button" onClick={() => void loadFees()} style={btnGhost} disabled={listLoading}>
            Refresh list
          </button>
        </div>
      </form>
    </section>
  );
}

const th: CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  borderBottom: "1px solid #ddd",
  background: "#eee",
  fontSize: 12,
};
const thR: CSSProperties = { ...th, textAlign: "right" };
const td: CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #f0f0f0", verticalAlign: "top" };
const tdR: CSSProperties = { ...td, textAlign: "right" };
