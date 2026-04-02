"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { bookingStatusStyle, spaceTypeLabel } from "@/lib/bookings/status-style";
import { loadScopedPropertiesForUser } from "@/lib/properties/scoped";
import { formatDateTime } from "@/lib/date/format";

type PropertyRow = { id: string; name: string; city: string | null; tenant_id: string };

type BookingRow = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  purpose: string | null;
  total_price: number | string | null;
  booker_type: string;
  booker_user_id: string | null;
  visitor_name: string | null;
  visitor_email: string | null;
  rejection_reason: string | null;
  bookable_spaces: { name: string; space_type: string } | null;
  properties: { name: string } | null;
};

type TenantUser = { id: string; email: string; display_name: string | null };

export default function ManageBookingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [userMap, setUserMap] = useState<Record<string, TenantUser>>({});
  const [actingId, setActingId] = useState<string | null>(null);

  const canViewManagePage = useMemo(
    () =>
      roles.some((r) =>
        ["owner", "manager", "super_admin", "customer_service"].includes(r)
      ),
    [roles]
  );

  const canApproveOrCancel = useMemo(
    () => roles.some((r) => ["owner", "manager", "super_admin"].includes(r)),
    [roles]
  );

  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === propertyId),
    [properties, propertyId]
  );

  const loadProperties = useCallback(async () => {
    const supabase = getSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }

    const { data: memberships, error: mErr } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id);
    if (mErr) throw new Error(mErr.message);
    const roleList = (memberships ?? []).map((m) => (m.role ?? "").toLowerCase());
    setRoles(roleList);
    const scoped = await loadScopedPropertiesForUser(supabase, user.id);
    const list = (scoped.properties as PropertyRow[]) ?? [];
    setProperties(list);
    setPropertyId((prev) => prev || list[0]?.id || "");
  }, [router]);

  const loadBookings = useCallback(async (pid: string) => {
    if (!pid) {
      setBookings([]);
      return;
    }
    const supabase = getSupabaseClient();
    const { data, error: bErr } = await supabase
      .from("bookings")
      .select(
        `
        id,
        start_at,
        end_at,
        status,
        purpose,
        total_price,
        booker_type,
        booker_user_id,
        visitor_name,
        visitor_email,
        rejection_reason,
        bookable_spaces ( name, space_type ),
        properties ( name )
      `
      )
      .eq("property_id", pid)
      .order("start_at", { ascending: false });

    if (bErr) throw new Error(bErr.message);
    setBookings((data as unknown as BookingRow[]) ?? []);
  }, []);

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
      try {
        await loadBookings(propertyId);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load bookings");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId, loadBookings]);

  useEffect(() => {
    if (!canApproveOrCancel || !selectedProperty?.tenant_id) {
      setUserMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/bookings/tenant-users?tenantId=${encodeURIComponent(selectedProperty.tenant_id)}`,
        { credentials: "include" }
      );
      const json = (await res.json()) as { users?: TenantUser[] };
      if (!res.ok || cancelled) return;
      const map: Record<string, TenantUser> = {};
      for (const u of json.users ?? []) {
        map[u.id] = u;
      }
      if (!cancelled) setUserMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [canApproveOrCancel, selectedProperty?.tenant_id]);

  function bookerLabel(b: BookingRow): string {
    if (b.booker_type === "visitor") {
      return `${b.visitor_name ?? "?"} (${b.visitor_email ?? "—"})`;
    }
    if (b.booker_user_id) {
      const u = userMap[b.booker_user_id];
      return u ? `${u.display_name ?? u.email}` : b.booker_user_id.slice(0, 8) + "…";
    }
    return "—";
  }

  async function approve(id: string) {
    setActingId(id);
    setError(null);
    const supabase = getSupabaseClient();
    const { error: uErr } = await supabase.from("bookings").update({ status: "confirmed" }).eq("id", id);
    if (uErr) {
      setError(uErr.message);
      setActingId(null);
      return;
    }
    await fetch("/api/bookings/email", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: id, kind: "approved" }),
    });
    await loadBookings(propertyId);
    setActingId(null);
  }

  async function reject(id: string) {
    const reason = prompt("Reason for rejection (shown to the booker)?");
    if (reason === null) return;
    setActingId(id);
    setError(null);
    const supabase = getSupabaseClient();
    const { error: uErr } = await supabase
      .from("bookings")
      .update({ status: "rejected", rejection_reason: reason || null })
      .eq("id", id);
    if (uErr) {
      setError(uErr.message);
      setActingId(null);
      return;
    }
    await fetch("/api/bookings/email", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rejectionReason: reason, bookingId: id, kind: "rejected" }),
    });
    await loadBookings(propertyId);
    setActingId(null);
  }

  async function cancelAsManager(id: string) {
    if (!confirm("Cancel this booking on behalf of the tenant?")) return;
    setActingId(id);
    setError(null);
    const supabase = getSupabaseClient();
    const { error: uErr } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", id);
    setActingId(null);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    await loadBookings(propertyId);
  }

  if (loading) {
    return <p>Loading...</p>;
  }

  if (!canViewManagePage) {
    return (
      <div>
        <h1 className="vw-admin-page-title" style={{ margin: "0 0 8px" }}>Manage bookings</h1>
        <p style={{ color: "#b00020" }}>
          You do not have access to this page. Owners, managers, customer service, and super admins can open it.
        </p>
      </div>
    );
  }

  const pending = bookings.filter((b) => b.status === "pending");
  const rest = bookings.filter((b) => b.status !== "pending");

  return (
    <div>
      <h1 className="vw-admin-page-title" style={{ margin: "0 0 8px" }}>Manage bookings</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        {canApproveOrCancel
          ? "Approve or reject pending requests."
          : "View-only listing for support. Approvals and cancellations are limited to owners and managers."}
      </p>

      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}

      <label style={{ display: "grid", gap: 6, maxWidth: 400, marginTop: 12 }}>
        <span>Property</span>
        <select
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.city ? ` — ${p.city}` : ""}
            </option>
          ))}
        </select>
      </label>

      <h2 style={{ marginTop: 24, fontSize: 18 }}>Pending approval</h2>
      {pending.length === 0 ? (
        <p>No pending bookings.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {pending.map((b) => (
            <li
              key={b.id}
              style={{ border: "1px solid #ffe69c", background: "#fffdf5", borderRadius: 12, padding: 14, marginBottom: 10 }}
            >
              <BookingCard b={b} bookerLabel={bookerLabel(b)} />
              {canApproveOrCancel ? (
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => approve(b.id)}
                    disabled={actingId !== null}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "1px solid #1b5e20",
                      background: "#e6f6ea",
                      cursor: actingId !== null ? "wait" : "pointer",
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => reject(b.id)}
                    disabled={actingId !== null}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "1px solid #b00020",
                      background: "#fbe8ea",
                      cursor: actingId !== null ? "wait" : "pointer",
                    }}
                  >
                    Reject
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 28, fontSize: 18 }}>All bookings</h2>
      {rest.length === 0 && pending.length === 0 ? (
        <p>No bookings for this property.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {rest.map((b) => {
            const st = bookingStatusStyle(b.status);
            const canStaffCancel =
              canApproveOrCancel && (b.status === "pending" || b.status === "confirmed");
            return (
              <li
                key={b.id}
                style={{ border: "1px solid #eee", borderRadius: 12, padding: 14, marginBottom: 10 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <BookingCard b={b} bookerLabel={bookerLabel(b)} />
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
                    {b.rejection_reason ? (
                      <div style={{ marginTop: 8, fontSize: 13, color: "#666" }}>
                        Rejection note: {b.rejection_reason}
                      </div>
                    ) : null}
                    {canStaffCancel ? (
                      <button
                        type="button"
                        onClick={() => cancelAsManager(b.id)}
                        disabled={actingId !== null}
                        style={{
                          display: "block",
                          marginTop: 10,
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: "1px solid #ddd",
                          background: "#fff",
                          cursor: actingId !== null ? "wait" : "pointer",
                        }}
                      >
                        Cancel booking
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

function BookingCard({ b, bookerLabel }: { b: BookingRow; bookerLabel: string }) {
  const space = b.bookable_spaces;
  const prop = b.properties;
  return (
    <div>
      <div style={{ fontWeight: 700 }}>
        {space?.name ?? "Space"} · {prop?.name ?? "Property"}
      </div>
      <div style={{ color: "#666", fontSize: 14 }}>
        {space ? spaceTypeLabel(space.space_type) : ""} · {formatDateTime(b.start_at)} →{" "}
        {formatDateTime(b.end_at)}
      </div>
      <div style={{ marginTop: 6, fontSize: 14 }}>
        Booker: <strong>{bookerLabel}</strong>
      </div>
      {b.purpose ? <div style={{ marginTop: 6 }}>{b.purpose}</div> : null}
      <div style={{ marginTop: 6, fontSize: 14, color: "#555" }}>Total: {b.total_price ?? "—"}</div>
    </div>
  );
}
