"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useCustomerPortal } from "@/context/CustomerPortalContext";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { formatDate } from "@/lib/date/format";

const PETROL = "#0D4F4F";

type BookingRow = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  total_price: number | string | null;
  customer_user_id: string | null;
  bookable_spaces: { name: string } | { name: string }[] | null;
  customer_users?: { first_name: string | null; last_name: string | null; email: string } | { first_name: string | null; last_name: string | null; email: string }[] | null;
};

function spaceName(b: BookingRow): string {
  const s = b.bookable_spaces;
  if (!s) return "—";
  if (Array.isArray(s)) return s[0]?.name ?? "—";
  return s.name ?? "—";
}

function employeeLabel(b: BookingRow): string {
  const u = b.customer_users;
  const row = Array.isArray(u) ? u[0] : u;
  if (!row) return "—";
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return name || row.email || "—";
}

function durationLabel(startIso: string, endIso: string): string {
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  const mins = Math.max(0, Math.round((b - a) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function statusBadge(status: string): { bg: string; fg: string } {
  const s = status.toLowerCase();
  if (s === "confirmed") return { bg: "#dcfce7", fg: "#15803d" };
  if (s === "pending") return { bg: "#fef9c3", fg: "#a16207" };
  if (s === "cancelled" || s === "rejected") return { bg: "#f1f5f9", fg: "#64748b" };
  return { bg: "#e0f2fe", fg: "#0369a1" };
}

export default function CustomerPortalBookingsPage() {
  const { customerUser } = useCustomerPortal();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const isCompanyAdmin = String(customerUser?.role ?? "").toLowerCase() === "company_admin";

  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [scope, setScope] = useState<"mine" | "company">("mine");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!customerUser?.id || !customerUser.company_id) return;
    setLoading(true);
    setErr(null);
    const nowIso = new Date().toISOString();

    let q = supabase.from("bookings").select(
      "id, start_at, end_at, status, total_price, customer_user_id, bookable_spaces(name), customer_users(first_name, last_name, email)",
    );

    if (scope === "mine" || !isCompanyAdmin) {
      q = q.eq("customer_user_id", customerUser.id);
    } else {
      q = q.eq("customer_company_id", customerUser.company_id);
    }

    if (tab === "upcoming") {
      q = q.gte("start_at", nowIso);
    } else {
      q = q.lt("start_at", nowIso);
    }

    if (dateFrom) q = q.gte("start_at", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) q = q.lte("start_at", `${dateTo}T23:59:59.999Z`);

    q = q.order("start_at", { ascending: tab === "upcoming" });

    const first = await q;
    let data: BookingRow[] | null = (first.data ?? []) as BookingRow[];
    let error = first.error;
    if (error?.message?.includes("customer_users")) {
      let q2 = supabase
        .from("bookings")
        .select("id, start_at, end_at, status, total_price, customer_user_id, bookable_spaces(name)");
      if (scope === "mine" || !isCompanyAdmin) q2 = q2.eq("customer_user_id", customerUser.id);
      else q2 = q2.eq("customer_company_id", customerUser.company_id);
      if (tab === "upcoming") q2 = q2.gte("start_at", nowIso);
      else q2 = q2.lt("start_at", nowIso);
      if (dateFrom) q2 = q2.gte("start_at", `${dateFrom}T00:00:00.000Z`);
      if (dateTo) q2 = q2.lte("start_at", `${dateTo}T23:59:59.999Z`);
      q2 = q2.order("start_at", { ascending: tab === "upcoming" });
      const second = await q2;
      data = (second.data ?? []) as BookingRow[];
      error = second.error;
    }
    setLoading(false);
    if (error) {
      setErr(error.message);
      setRows([]);
      return;
    }
    let list = data ?? [];
    if (tab === "past") {
      list = [...list].sort((a, b) => +new Date(b.start_at) - +new Date(a.start_at));
    }
    setRows(list);
  }, [customerUser, supabase, tab, scope, dateFrom, dateTo, isCompanyAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancelBooking(id: string) {
    if (!confirm("Cancel this booking?")) return;
    setActingId(id);
    const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", id);
    setActingId(null);
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  const th: CSSProperties = {
    textAlign: "left",
    padding: "10px 12px",
    background: PETROL,
    color: "#fff",
    fontWeight: 600,
    fontSize: 13,
    whiteSpace: "nowrap",
  };
  const td: CSSProperties = { padding: "10px 12px", borderBottom: "1px solid #e5e7eb", fontSize: 13 };

  const showCompanyScope = isCompanyAdmin;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: PETROL }}>My Bookings</h1>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <div style={{ display: "inline-flex", borderRadius: 10, border: `1px solid ${PETROL}`, overflow: "hidden" }}>
          <button
            type="button"
            onClick={() => setTab("upcoming")}
            style={{
              padding: "8px 16px",
              border: "none",
              background: tab === "upcoming" ? PETROL : "#fff",
              color: tab === "upcoming" ? "#fff" : PETROL,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Upcoming
          </button>
          <button
            type="button"
            onClick={() => setTab("past")}
            style={{
              padding: "8px 16px",
              border: "none",
              background: tab === "past" ? PETROL : "#fff",
              color: tab === "past" ? "#fff" : PETROL,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Past
          </button>
        </div>

        {showCompanyScope ? (
          <div style={{ display: "inline-flex", borderRadius: 10, border: "1px solid #cbd5e1", overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => setScope("mine")}
              style={{
                padding: "8px 14px",
                border: "none",
                background: scope === "mine" ? "#e2e8f0" : "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              My Bookings
            </button>
            <button
              type="button"
              onClick={() => setScope("company")}
              style={{
                padding: "8px 14px",
                border: "none",
                background: scope === "company" ? "#e2e8f0" : "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              All Company Bookings
            </button>
          </div>
        ) : null}

        <label style={{ fontSize: 13, color: "#64748b" }}>
          From{" "}
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ marginLeft: 4, padding: 6, borderRadius: 6, border: "1px solid #e2e8f0" }} />
        </label>
        <label style={{ fontSize: 13, color: "#64748b" }}>
          To{" "}
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ marginLeft: 4, padding: 6, borderRadius: 6, border: "1px solid #e2e8f0" }} />
        </label>
        <button
          type="button"
          onClick={() => {
            setDateFrom("");
            setDateTo("");
          }}
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer" }}
        >
          Clear dates
        </button>
      </div>

      {err ? (
        <p style={{ color: "#b91c1c" }} role="alert">
          {err}
        </p>
      ) : null}

      {loading ? (
        <p style={{ color: "#64748b" }}>Loading…</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
          <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  "Space",
                  ...(scope === "company" && showCompanyScope ? ["Employee"] : []),
                  "Date",
                  "Time",
                  "Duration",
                  "Price",
                  "Status",
                  "Actions",
                ].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const st = statusBadge(b.status);
                const start = new Date(b.start_at);
                const end = new Date(b.end_at);
                const canCancel =
                  tab === "upcoming" && (b.status === "confirmed" || b.status === "pending");
                return (
                  <tr key={b.id}>
                    <td style={td}>{spaceName(b)}</td>
                    {scope === "company" && showCompanyScope ? <td style={td}>{employeeLabel(b)}</td> : null}
                    <td style={td}>{formatDate(b.start_at)}</td>
                    <td style={td}>
                      {start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} –{" "}
                      {end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td style={td}>{durationLabel(b.start_at, b.end_at)}</td>
                    <td style={td}>{b.total_price != null ? `€${Number(b.total_price).toFixed(2)}` : "—"}</td>
                    <td style={td}>
                      <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: st.bg, color: st.fg }}>{b.status}</span>
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {canCancel ? (
                        <button
                          type="button"
                          disabled={actingId === b.id}
                          onClick={() => void cancelBooking(b.id)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#b91c1c",
                            cursor: actingId === b.id ? "wait" : "pointer",
                            fontWeight: 600,
                            padding: 0,
                            font: "inherit",
                          }}
                        >
                          Cancel
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 ? <p style={{ padding: 16, margin: 0, color: "#64748b" }}>No bookings found.</p> : null}
        </div>
      )}
    </div>
  );
}
