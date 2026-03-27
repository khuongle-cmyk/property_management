"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { bookingStatusStyle, spaceTypeLabel } from "@/lib/bookings/status-style";
import { formatDateTime } from "@/lib/date/format";

type BookingRow = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  purpose: string | null;
  total_price: number | string | null;
  deposit_paid: boolean;
  payment_made: boolean;
  bookable_spaces: { name: string; space_type: string } | null;
  properties: { name: string } | null;
};

export default function MyBookingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }

    const { data, error: qErr } = await supabase
      .from("bookings")
      .select(
        `
        id,
        start_at,
        end_at,
        status,
        purpose,
        total_price,
        deposit_paid,
        payment_made,
        bookable_spaces ( name, space_type ),
        properties ( name )
      `
      )
      .eq("booker_type", "registered_user")
      .eq("booker_user_id", user.id)
      .order("start_at", { ascending: false });

    if (qErr) throw new Error(qErr.message);
    setRows((data as unknown as BookingRow[]) ?? []);
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function cancelBooking(id: string) {
    if (!confirm("Cancel this booking?")) return;
    setActingId(id);
    setError(null);
    const supabase = getSupabaseClient();
    const { error: uErr } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", id);
    setActingId(null);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    await load();
  }

  if (loading) {
    return <p>Loading...</p>;
  }

  return (
    <div>
      <h1 style={{ margin: "0 0 8px" }}>My bookings</h1>
      <p style={{ marginTop: 0, color: "#555" }}>Reservations where you are the booker.</p>

      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}

      {rows.length === 0 ? (
        <p>No bookings yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0" }}>
          {rows.map((b) => {
            const st = bookingStatusStyle(b.status);
            const space = b.bookable_spaces;
            const prop = b.properties;
            const canCancel = b.status === "pending" || b.status === "confirmed";
            return (
              <li
                key={b.id}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {space?.name ?? "Space"} · {prop?.name ?? "Property"}
                    </div>
                    <div style={{ color: "#666", fontSize: 14 }}>
                      {space ? spaceTypeLabel(space.space_type) : ""} ·{" "}
                      {formatDateTime(b.start_at)} → {formatDateTime(b.end_at)}
                    </div>
                    {b.purpose ? <div style={{ marginTop: 6 }}>{b.purpose}</div> : null}
                    <div style={{ marginTop: 8, fontSize: 14, color: "#555" }}>
                      Total: {b.total_price ?? "—"} · Deposit: {b.deposit_paid ? "yes" : "no"} · Paid:{" "}
                      {b.payment_made ? "yes" : "no"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: st.bg,
                        color: st.fg,
                        border: `1px solid ${st.bd}`,
                        fontSize: 13,
                        textTransform: "capitalize",
                      }}
                    >
                      {b.status}
                    </span>
                    {canCancel ? (
                      <button
                        type="button"
                        onClick={() => cancelBooking(b.id)}
                        disabled={actingId !== null}
                        style={{
                          display: "block",
                          marginTop: 10,
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: "1px solid #ddd",
                          background: "#fff",
                          cursor: actingId === b.id ? "wait" : "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
