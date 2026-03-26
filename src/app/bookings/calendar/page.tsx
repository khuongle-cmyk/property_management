"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { bookingStatusStyle, spaceTypeLabel } from "@/lib/bookings/status-style";

type PropertyRow = { id: string; name: string; city: string | null; tenant_id: string };

type BookingRow = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  purpose: string | null;
  bookable_spaces: { name: string; space_type: string } | null;
};

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function overlapsDay(booking: BookingRow, day: Date): boolean {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  const bs = new Date(booking.start_at);
  const be = new Date(booking.end_at);
  return bs < end && be > start;
}

function BookingsCalendarContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [propertyId, setPropertyId] = useState<string>("");
  const [weekStart, setWeekStart] = useState(() => startOfWeekMonday(new Date()));
  const [bookings, setBookings] = useState<BookingRow[]>([]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const loadProperties = useCallback(async () => {
    const supabase = getSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }

    const { data: memberships, error: mErr } = await supabase.from("memberships").select("tenant_id, role");
    if (mErr) throw new Error(mErr.message);

    const roles = (memberships ?? []).map((m) => (m.role ?? "").toLowerCase());
    const isSuperAdmin = roles.includes("super_admin");
    const tenantIds = [
      ...new Set(
        (memberships ?? [])
          .map((m) => m.tenant_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];

    let q = supabase.from("properties").select("id, name, city, tenant_id").order("name", { ascending: true });
    if (!isSuperAdmin) {
      if (tenantIds.length === 0) {
        setProperties([]);
        return;
      }
      q = q.in("tenant_id", tenantIds);
    }

    const { data: props, error: pErr } = await q;
    if (pErr) throw new Error(pErr.message);
    const list = (props as PropertyRow[]) ?? [];
    setProperties(list);
    setPropertyId((prev) => prev || list[0]?.id || "");
  }, [router]);

  const loadBookings = useCallback(async () => {
    if (!propertyId) {
      setBookings([]);
      return;
    }
    const supabase = getSupabaseClient();
    const weekEnd = addDays(weekStart, 7);
    const { data, error: bErr } = await supabase
      .from("bookings")
      .select(
        `
        id,
        start_at,
        end_at,
        status,
        purpose,
        bookable_spaces ( name, space_type )
      `
      )
      .eq("property_id", propertyId)
      .lt("start_at", weekEnd.toISOString())
      .gt("end_at", weekStart.toISOString())
      .order("start_at", { ascending: true });

    if (bErr) throw new Error(bErr.message);

    const raw = (data ?? []) as unknown as BookingRow[];
    setBookings(raw);
  }, [propertyId, weekStart]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadProperties();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProperties]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!propertyId) return;
      setError(null);
      try {
        await loadBookings();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load bookings");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBookings, propertyId]);

  useEffect(() => {
    const qp = searchParams.get("propertyId")?.trim();
    if (!qp || properties.length === 0) return;
    if (properties.some((p) => p.id === qp)) {
      setPropertyId(qp);
    }
  }, [searchParams, properties]);

  if (loading && properties.length === 0) {
    return <p>Loading...</p>;
  }

  return (
    <div>
      <h1 style={{ margin: "0 0 8px" }}>Booking calendar</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Weekly view, color-coded by status. Overlaps are blocked when you book.
      </p>

      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginTop: 16 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 13, color: "#555" }}>Property</span>
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd", minWidth: 220 }}
          >
            {properties.length === 0 ? (
              <option value="">No properties</option>
            ) : (
              properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.city ? ` — ${p.city}` : ""}
                </option>
              ))
            )}
          </select>
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff" }}
          >
            ← Previous week
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(startOfWeekMonday(new Date()))}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff" }}
          >
            This week
          </button>
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff" }}
          >
            Next week →
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 8,
          marginTop: 20,
        }}
      >
        {weekDays.map((day) => (
          <div key={day.toISOString()} style={{ border: "1px solid #eee", borderRadius: 10, padding: 8, minHeight: 200 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{dayLabel(day)}</div>
            {bookings
              .filter((b) => overlapsDay(b, day))
              .map((b) => {
                const st = bookingStatusStyle(b.status);
                const space = b.bookable_spaces;
                return (
                  <div
                    key={b.id}
                    style={{
                      marginBottom: 8,
                      padding: 8,
                      borderRadius: 8,
                      background: st.bg,
                      color: st.fg,
                      border: `1px solid ${st.bd}`,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{space?.name ?? "Space"}</div>
                    <div style={{ opacity: 0.9 }}>{space ? spaceTypeLabel(space.space_type) : ""}</div>
                    <div>
                      {new Date(b.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
                      {new Date(b.end_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div style={{ textTransform: "capitalize", marginTop: 4 }}>{b.status}</div>
                    {b.purpose ? <div style={{ marginTop: 4 }}>{b.purpose}</div> : null}
                  </div>
                );
              })}
          </div>
        ))}
      </div>

      <p style={{ marginTop: 20, fontSize: 14 }}>
        <Link href="/bookings/new">Create a booking</Link>
      </p>
    </div>
  );
}

export default function BookingsCalendarPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <BookingsCalendarContent />
    </Suspense>
  );
}
