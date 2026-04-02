"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  property_id: string;
  name: string;
  floor_number: number;
  status: string;
  updated_at: string;
  property_name: string | null;
  room_count: number;
};

export default function FloorPlansListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filterPropertyId = searchParams.get("propertyId")?.trim() ?? "";

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const q = filterPropertyId ? `?propertyId=${encodeURIComponent(filterPropertyId)}` : "";
    const res = await fetch(`/api/floor-plans${q}`);
    const json = (await res.json()) as { floorPlans?: Row[]; error?: string };
    if (!res.ok) {
      setError(json.error ?? "Failed to load");
      setRows([]);
      return;
    }
    setRows(json.floorPlans ?? []);
  }, [filterPropertyId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function onDuplicate(id: string) {
    const res = await fetch(`/api/floor-plans/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
    const json = (await res.json()) as { id?: string; error?: string };
    if (!res.ok) {
      setError(json.error ?? "Duplicate failed");
      return;
    }
    if (json.id) router.push(`/floor-plans/${encodeURIComponent(json.id)}/edit`);
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleteBusy(true);
    setError(null);
    const res = await fetch(`/api/floor-plans/${encodeURIComponent(deleteId)}`, { method: "DELETE" });
    const json = (await res.json()) as { error?: string };
    setDeleteBusy(false);
    if (!res.ok) setError(json.error ?? "Delete failed");
    else {
      setDeleteId(null);
      await load();
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/dashboard" style={{ fontSize: 14 }}>
          ← Dashboard
        </Link>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <h1 className="vw-admin-page-title" style={{ margin: 0 }}>Floor planner</h1>
        <Link
          href={filterPropertyId ? `/floor-plans/new?propertyId=${encodeURIComponent(filterPropertyId)}` : "/floor-plans/new"}
          style={{
            padding: "10px 18px",
            background: "#1a4a4a",
            color: "#fff",
            borderRadius: 8,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          New floor plan
        </Link>
      </div>

      {filterPropertyId ? (
        <p style={{ color: "#555", marginTop: 0 }}>
          Filtered by property.{" "}
          <Link href="/floor-plans" style={{ color: "#1a4a4a" }}>
            Show all
          </Link>
        </p>
      ) : null}

      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}

      {loading ? (
        <p style={{ color: "#666" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "#666" }}>No plans yet. Create one to start drawing.</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                <th style={{ padding: 12 }}>Property</th>
                <th style={{ padding: 12 }}>Floor</th>
                <th style={{ padding: 12 }}>Name</th>
                <th style={{ padding: 12 }}>Rooms</th>
                <th style={{ padding: 12 }}>Status</th>
                <th style={{ padding: 12 }}>Updated</th>
                <th style={{ padding: 12 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 12 }}>{r.property_name ?? "—"}</td>
                  <td style={{ padding: 12 }}>{r.floor_number}</td>
                  <td style={{ padding: 12 }}>{r.name}</td>
                  <td style={{ padding: 12 }}>{r.room_count}</td>
                  <td style={{ padding: 12 }}>{r.status}</td>
                  <td style={{ padding: 12, color: "#555" }}>{new Date(r.updated_at).toLocaleString()}</td>
                  <td style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <Link href={`/floor-plans/${r.id}/edit`} style={{ color: "#1a4a4a" }}>
                      Edit
                    </Link>
                    <Link href={`/floor-plans/${r.id}/view`} style={{ color: "#1a4a4a" }}>
                      View
                    </Link>
                    <button type="button" style={{ background: "none", border: "none", color: "#b00020", cursor: "pointer", padding: 0 }} onClick={() => setDeleteId(r.id)}>
                      Delete
                    </button>
                    <button type="button" style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 }} onClick={() => onDuplicate(r.id)}>
                      Duplicate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteId ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-floor-plan-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 16,
          }}
          onClick={() => (deleteBusy ? null : setDeleteId(null))}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 24,
              maxWidth: 400,
              width: "100%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-floor-plan-title" style={{ margin: "0 0 12px", fontSize: 18 }}>
              Delete floor plan
            </h2>
            <p style={{ margin: "0 0 20px", color: "#374151", lineHeight: 1.5 }}>
              Delete this floor plan? This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setDeleteId(null)}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: deleteBusy ? "not-allowed" : "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => void confirmDelete()}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "#b00020",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: deleteBusy ? "not-allowed" : "pointer",
                }}
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
