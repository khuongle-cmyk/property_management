"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import {
  PROPERTY_COST_TYPE_LABELS,
  PROPERTY_COST_TYPES,
  RECURRING_FREQUENCIES,
} from "@/lib/property-costs/constants";

type PropertyRow = {
  id: string;
  name: string | null;
  city: string | null;
  address: string | null;
  tenant_id: string | null;
};

type CostEntry = {
  id: string;
  cost_type: string;
  description: string;
  amount: number;
  cost_date: string;
  period_month: string;
  supplier_name: string | null;
  invoice_number: string | null;
  notes: string | null;
  status: string;
  source: string;
  recurring_template_id: string | null;
};

type TemplateRow = {
  id: string;
  cost_type: string;
  description: string;
  amount: number;
  supplier_name: string | null;
  recurring_frequency: string;
  start_month: string;
  end_month: string | null;
  active: boolean;
};

type FurnitureRow = {
  id: string;
  room_id: string | null;
  name: string;
  category: string;
  quantity: number;
  condition: string;
  status: string;
};

export default function PropertyCostsPage() {
  const router = useRouter();
  const params = useParams();
  const propertyId = typeof params.id === "string" ? params.id : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [property, setProperty] = useState<PropertyRow | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [entries, setEntries] = useState<CostEntry[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [furniture, setFurniture] = useState<FurnitureRow[]>([]);

  const [costType, setCostType] = useState<string>("cleaning");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [costDate, setCostDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [supplier, setSupplier] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState("monthly");
  const [recurringEndMonth, setRecurringEndMonth] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);

  const [csvPreview, setCsvPreview] = useState<string[][] | null>(null);
  const [csvText, setCsvText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!propertyId) return;
    const supabase = getSupabaseClient();
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }

    const { data: prop, error: pErr } = await supabase.from("properties").select("*").eq("id", propertyId).maybeSingle();
    if (pErr) {
      setError(pErr.message);
      setLoading(false);
      return;
    }
    if (!prop) {
      setError("Property not found or not accessible.");
      setLoading(false);
      return;
    }
    setProperty(prop as PropertyRow);

    const { data: mem } = await supabase.from("memberships").select("role, tenant_id").eq("user_id", user.id);
    const rows = (mem ?? []) as { role: string | null; tenant_id: string | null }[];
    const superA = rows.some((r) => (r.role ?? "").toLowerCase() === "super_admin");
    const tid = (prop as PropertyRow).tenant_id;
    const rolesOn = rows.filter((r) => r.tenant_id === tid).map((r) => (r.role ?? "").toLowerCase());
    const write =
      superA || rolesOn.some((r) => ["owner", "manager", "accounting"].includes(r));
    const read =
      superA || rolesOn.some((r) => ["owner", "manager", "accounting", "viewer", "maintenance"].includes(r));
    if (!read) {
      setError("You do not have access to this property.");
      setLoading(false);
      return;
    }
    setCanWrite(write);

    const res = await fetch(`/api/property-costs?propertyId=${encodeURIComponent(propertyId)}`);
    const json = (await res.json()) as {
      entries?: CostEntry[];
      templates?: TemplateRow[];
      error?: string;
    };
    if (!res.ok) {
      setError(json.error ?? "Failed to load costs");
      setLoading(false);
      return;
    }
    setEntries(json.entries ?? []);
    setTemplates(json.templates ?? []);

    const { data: furnitureRows } = await supabase
      .from("furniture_items")
      .select("id,room_id,name,category,quantity,condition,status")
      .eq("property_id", propertyId)
      .order("name", { ascending: true });
    setFurniture((furnitureRows ?? []) as FurnitureRow[]);
    setLoading(false);
  }, [propertyId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAddCost(e: FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    setSaveBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/property-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          costType,
          description,
          amount: Number(amount),
          costDate,
          supplierName: supplier || null,
          invoiceNumber: invoiceNumber || null,
          notes: notes || null,
          recurring,
          recurringFrequency: recurring ? recurringFrequency : null,
          recurringEndMonth: recurring && recurringEndMonth.trim() ? `${recurringEndMonth.trim().slice(0, 7)}-01` : null,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; template?: unknown; entry?: unknown };
      if (!res.ok) {
        setError(json.error ?? "Save failed");
        return;
      }
      setDescription("");
      setAmount("");
      setInvoiceNumber("");
      setNotes("");
      setRecurring(false);
      await load();
    } finally {
      setSaveBusy(false);
    }
  }

  async function onDeleteEntry(id: string) {
    if (!canWrite || !confirm("Delete this cost line?")) return;
    const res = await fetch(`/api/property-costs/${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) setError(json.error ?? "Delete failed");
    else await load();
  }

  async function onConfirmEntry(id: string) {
    if (!canWrite) return;
    const res = await fetch(`/api/property-costs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "confirmed" }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) setError(json.error ?? "Update failed");
    else await load();
  }

  async function onDeleteTemplate(id: string) {
    if (!canWrite || !confirm("Remove this recurring template and scheduled future lines?")) return;
    const res = await fetch(`/api/property-costs/recurring/${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) setError(json.error ?? "Delete failed");
    else await load();
  }

  async function onRemoveFromRoom(id: string) {
    if (!canWrite) return;
    const supabase = getSupabaseClient();
    const { error: uErr } = await supabase
      .from("furniture_items")
      .update({ room_id: null })
      .eq("id", id);
    if (uErr) setError(uErr.message);
    else await load();
  }

  function onPickCsv(f: File | null) {
    setImportResult(null);
    setCsvPreview(null);
    setCsvText("");
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const grid = lines.slice(0, 12).map((line) => {
        const cells: string[] = [];
        let cur = "";
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') inQ = !inQ;
          else if (c === "," && !inQ) {
            cells.push(cur.trim().replace(/^"|"$/g, ""));
            cur = "";
          } else cur += c;
        }
        cells.push(cur.trim().replace(/^"|"$/g, ""));
        return cells;
      });
      setCsvPreview(grid);
    };
    reader.readAsText(f);
  }

  async function onImportCsv() {
    if (!canWrite || !csvText.trim()) return;
    setImportBusy(true);
    setImportResult(null);
    setError(null);
    try {
      const res = await fetch("/api/property-costs/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, csvText }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        imported?: number;
        failed?: number;
        results?: { rowNumber: number; ok: boolean; error?: string }[];
      };
      if (!res.ok) {
        setError(json.error ?? "Import failed");
        return;
      }
      const bad = (json.results ?? []).filter((r) => !r.ok);
      setImportResult(
        `Imported ${json.imported ?? 0} row(s). Failed: ${json.failed ?? 0}.` +
          (bad.length ? ` First errors: ${bad.slice(0, 3).map((b) => `row ${b.rowNumber}: ${b.error}`).join("; ")}` : ""),
      );
      setCsvText("");
      setCsvPreview(null);
      await load();
    } finally {
      setImportBusy(false);
    }
  }

  if (!propertyId) {
    return (
      <main>
        <p>Invalid property.</p>
      </main>
    );
  }

  if (loading) return <p style={{ color: "#666" }}>Loading…</p>;

  return (
    <main>
      <div style={{ marginBottom: 16 }}>
        <Link href="/dashboard" style={{ fontSize: 14 }}>
          ← Dashboard
        </Link>
      </div>

      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}

      {property ? (
        <>
          <h1 className="vw-admin-page-title" style={{ margin: "0 0 8px" }}>{property.name ?? "Property"}</h1>
          <p style={{ margin: "0 0 8px", color: "#555" }}>
            {[property.address, property.city].filter(Boolean).join(" · ") || "Property operating costs"}
          </p>
          <p style={{ fontSize: 14, display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
            <Link href={`/rooms`}>Rooms dashboard</Link>
            <Link href={`/floor-plans?propertyId=${encodeURIComponent(propertyId)}`}>Floor planner</Link>
            <Link href={`/reports/rent-roll?propertyId=${encodeURIComponent(propertyId)}`}>Rent roll report</Link>
            <Link href={`/reports/net-income?propertyId=${encodeURIComponent(propertyId)}`}>Net income report</Link>
          </p>

          {canWrite ? (
            <>
              <section style={{ marginTop: 28, padding: 16, border: "1px solid #eee", borderRadius: 12 }}>
                <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>Add cost</h2>
                <form onSubmit={onAddCost} style={{ display: "grid", gap: 12, maxWidth: 560 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Cost type</span>
                    <select value={costType} onChange={(e) => setCostType(e.target.value)} style={inp}>
                      {PROPERTY_COST_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {PROPERTY_COST_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Description</span>
                    <input value={description} onChange={(e) => setDescription(e.target.value)} style={inp} required />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Amount (€)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      style={inp}
                      required
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Date</span>
                    <input type="date" value={costDate} onChange={(e) => setCostDate(e.target.value)} style={inp} required />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Supplier</span>
                    <input value={supplier} onChange={(e) => setSupplier(e.target.value)} style={inp} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Invoice #</span>
                    <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} style={inp} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Notes</span>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={inp} />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
                    <span>Recurring</span>
                  </label>
                  {recurring ? (
                    <>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span>Frequency</span>
                        <select value={recurringFrequency} onChange={(e) => setRecurringFrequency(e.target.value)} style={inp}>
                          {RECURRING_FREQUENCIES.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span>End month (optional, YYYY-MM)</span>
                        <input
                          placeholder="e.g. 2026-12"
                          value={recurringEndMonth}
                          onChange={(e) => setRecurringEndMonth(e.target.value)}
                          style={inp}
                        />
                      </label>
                    </>
                  ) : null}
                  <button type="submit" disabled={saveBusy} style={btn}>
                    {saveBusy ? "Saving…" : recurring ? "Create recurring template" : "Save cost"}
                  </button>
                </form>
              </section>

              <section style={{ marginTop: 22, padding: 16, border: "1px solid #eee", borderRadius: 12 }}>
                <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>CSV import</h2>
                <p style={{ fontSize: 13, color: "#666", margin: "0 0 10px" }}>
                  Columns: date, cost_type, description, amount, supplier, invoice_number, recurring, recurring_frequency,
                  notes
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  <a href="/api/property-costs/template" download style={{ ...btn, display: "inline-block", textAlign: "center", textDecoration: "none" }}>
                    Download template
                  </a>
                  <label style={{ ...btn, display: "inline-block", cursor: "pointer", margin: 0 }}>
                    Choose CSV
                    <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => onPickCsv(e.target.files?.[0] ?? null)} />
                  </label>
                </div>
                {csvPreview ? (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 13, marginBottom: 6 }}>Preview (first rows)</div>
                    <div style={{ overflowX: "auto", fontSize: 12, border: "1px solid #eee", maxHeight: 220 }}>
                      <table style={{ borderCollapse: "collapse" }}>
                        <tbody>
                          {csvPreview.map((row, i) => (
                            <tr key={i}>
                              {row.map((c, j) => (
                                <td key={j} style={{ borderBottom: "1px solid #f3f3f3", padding: "4px 8px" }}>
                                  {c}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button type="button" disabled={importBusy} onClick={() => void onImportCsv()} style={{ ...btn, marginTop: 10 }}>
                      {importBusy ? "Importing…" : "Import"}
                    </button>
                  </div>
                ) : null}
                {importResult ? <p style={{ fontSize: 13 }}>{importResult}</p> : null}
              </section>
            </>
          ) : (
            <p style={{ marginTop: 20, color: "#666" }}>You have read-only access; costs can be managed by owners, managers, or accounting.</p>
          )}

          <section style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 16 }}>Furniture per room</h2>
            {furniture.length === 0 ? (
              <p style={{ color: "#666", fontSize: 14 }}>No furniture items for this property yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
                <thead>
                  <tr>
                    <th style={th}>Room</th>
                    <th style={th}>Item</th>
                    <th style={th}>Category</th>
                    <th style={th}>Condition</th>
                    <th style={th}>Status</th>
                    <th style={thR}>Qty</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {furniture.map((f) => (
                    <tr key={f.id}>
                      <td style={td}>{f.room_id ? f.room_id.slice(0, 8) : "Unassigned"}</td>
                      <td style={td}>{f.name}</td>
                      <td style={td}>{f.category}</td>
                      <td style={td}>{f.condition}</td>
                      <td style={td}>{f.status}</td>
                      <td style={tdR}>{f.quantity}</td>
                      <td style={td}>
                        {f.room_id && canWrite ? (
                          <button type="button" onClick={() => void onRemoveFromRoom(f.id)} style={{ fontSize: 12 }}>
                            Remove from room
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 16 }}>Recurring templates</h2>
            {templates.length === 0 ? (
              <p style={{ color: "#666", fontSize: 14 }}>None yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
                <thead>
                  <tr>
                    <th style={th}>Type</th>
                    <th style={th}>Description</th>
                    <th style={thR}>Amount</th>
                    <th style={th}>Frequency</th>
                    <th style={th}>Start</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id}>
                      <td style={td}>{PROPERTY_COST_TYPE_LABELS[t.cost_type as keyof typeof PROPERTY_COST_TYPE_LABELS] ?? t.cost_type}</td>
                      <td style={td}>{t.description}</td>
                      <td style={tdR}>{t.amount}</td>
                      <td style={td}>{t.recurring_frequency}</td>
                      <td style={td}>{t.start_month}</td>
                      <td style={td}>
                        {canWrite ? (
                          <button type="button" onClick={() => void onDeleteTemplate(t.id)} style={{ fontSize: 12 }}>
                            Remove
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 16 }}>Cost lines</h2>
            {entries.length === 0 ? (
              <p style={{ color: "#666", fontSize: 14 }}>No cost entries for this property yet.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th style={th}>Period</th>
                      <th style={th}>Type</th>
                      <th style={th}>Description</th>
                      <th style={thR}>Amount</th>
                      <th style={th}>Supplier</th>
                      <th style={th}>Status</th>
                      <th style={th}>Source</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id}>
                        <td style={td}>{e.period_month}</td>
                        <td style={td}>{PROPERTY_COST_TYPE_LABELS[e.cost_type as keyof typeof PROPERTY_COST_TYPE_LABELS] ?? e.cost_type}</td>
                        <td style={td}>{e.description}</td>
                        <td style={tdR}>{e.amount}</td>
                        <td style={td}>{e.supplier_name ?? "—"}</td>
                        <td style={td}>{e.status}</td>
                        <td style={td}>{e.source}</td>
                        <td style={td}>
                          {canWrite ? (
                            <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {e.status === "scheduled" ? (
                                <button type="button" onClick={() => void onConfirmEntry(e.id)} style={{ fontSize: 11 }}>
                                  Confirm
                                </button>
                              ) : null}
                              <button type="button" onClick={() => void onDeleteEntry(e.id)} style={{ fontSize: 11 }}>
                                Delete
                              </button>
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

const inp: CSSProperties = { padding: 8, borderRadius: 8, border: "1px solid #ddd", font: "inherit" };

const btn: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  cursor: "pointer",
};

const th: CSSProperties = { textAlign: "left", padding: 8, borderBottom: "1px solid #ddd", background: "#fafafa" };
const thR: CSSProperties = { ...th, textAlign: "right" };
const td: CSSProperties = { padding: 8, borderBottom: "1px solid #f4f4f4" };
const tdR: CSSProperties = { ...td, textAlign: "right" };
