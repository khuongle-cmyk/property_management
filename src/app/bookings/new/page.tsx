"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { spaceTypeLabel } from "@/lib/bookings/status-style";
import { normalizeSpaceTypeKey } from "@/lib/bookings/space-availability";
import { loadScopedPropertiesForUser } from "@/lib/properties/scoped";

type PropertyRow = { id: string; name: string; city: string | null; tenant_id: string };
type SpaceRow = {
  id: string;
  name: string;
  space_type: string;
  hourly_price: number;
  requires_approval: boolean;
  space_status: string;
  is_published?: boolean | null;
};
type TenantUser = { id: string; email: string; display_name: string | null };

function localToIso(value: string): string {
  return new Date(value).toISOString();
}

export default function NewBookingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [spaceId, setSpaceId] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [purpose, setPurpose] = useState("");
  const [attendeeCount, setAttendeeCount] = useState(1);

  const [roles, setRoles] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);

  const [bookerMode, setBookerMode] = useState<"self" | "visitor" | "member">("self");
  const [visitorName, setVisitorName] = useState("");
  const [visitorEmail, setVisitorEmail] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [onBehalfTenantEmail, setOnBehalfTenantEmail] = useState("");

  const canCreate = useMemo(
    () => roles.some((r) => ["super_admin", "owner", "manager", "tenant"].includes(r)),
    [roles]
  );

  const canBookForOthers = useMemo(
    () => roles.some((r) => ["super_admin", "owner", "manager"].includes(r)),
    [roles]
  );

  const showOnBehalfTenantEmailField = useMemo(
    () => roles.some((r) => ["super_admin", "owner", "manager"].includes(r)),
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
    setUserId(user.id);

    const { data: memberships, error: mErr } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id);
    if (mErr) throw new Error(mErr.message);
    const roleList = (memberships ?? []).map((m) => (m.role ?? "").toLowerCase());
    setRoles(roleList);
    const scoped = await loadScopedPropertiesForUser(supabase, user.id);
    const list = (scoped.properties as PropertyRow[]) ?? [];
    setProperties(list);
    setPropertyId((prev) => prev || list[0]?.id || "");
  }, [router]);

  const loadSpaces = useCallback(async (pid: string) => {
    if (!pid) {
      setSpaces([]);
      setSpaceId("");
      return;
    }
    const supabase = getSupabaseClient();
    const { data, error: sErr } = await supabase
      .from("bookable_spaces")
      .select("id, name, space_type, hourly_price, requires_approval, space_status, is_published")
      .eq("property_id", pid)
      .in("space_status", ["available", "vacant"])
      .not("space_type", "eq", "office")
      .order("name", { ascending: true });

    if (sErr) throw new Error(sErr.message);
    const list = ((data as SpaceRow[]) ?? []).filter(
      (s) => normalizeSpaceTypeKey(s.space_type) !== "office" && s.is_published !== false,
    );
    setSpaces(list);
    setSpaceId((prev) => {
      if (prev && list.some((s) => s.id === prev)) return prev;
      return list[0]?.id ?? "";
    });
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
        await loadSpaces(propertyId);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load spaces");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId, loadSpaces]);

  useEffect(() => {
    if (!canBookForOthers || !selectedProperty?.tenant_id) {
      setTenantUsers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/bookings/tenant-users?tenantId=${encodeURIComponent(selectedProperty.tenant_id)}`,
        { credentials: "include" }
      );
      const json = (await res.json()) as { users?: TenantUser[]; error?: string };
      if (!res.ok) {
        if (!cancelled) console.warn(json.error ?? "tenant users");
        return;
      }
      if (!cancelled) setTenantUsers(json.users ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [canBookForOthers, selectedProperty?.tenant_id]);

  useEffect(() => {
    if (!canBookForOthers && bookerMode !== "self") {
      setBookerMode("self");
    }
  }, [canBookForOthers, bookerMode]);

  useEffect(() => {
    if (bookerMode === "self") {
      setOnBehalfTenantEmail("");
    }
  }, [bookerMode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    if (!canCreate) {
      setError("You do not have permission to create bookings.");
      setSaving(false);
      return;
    }

    if (!spaceId || !startLocal || !endLocal) {
      setError("Choose a space, start, and end time.");
      setSaving(false);
      return;
    }

    const startIso = localToIso(startLocal);
    const endIso = localToIso(endLocal);
    if (new Date(endIso) <= new Date(startIso)) {
      setError("End time must be after start time.");
      setSaving(false);
      return;
    }

    const supabase = getSupabaseClient();
    let insertPayload: Record<string, unknown>;

    if (!canBookForOthers || bookerMode === "self") {
      if (!userId) {
        setError("Not signed in.");
        setSaving(false);
        return;
      }
      insertPayload = {
        space_id: spaceId,
        booker_type: "registered_user",
        booker_user_id: userId,
        start_at: startIso,
        end_at: endIso,
        purpose: purpose.trim() || null,
        attendee_count: attendeeCount,
      };
    } else if (bookerMode === "visitor") {
      insertPayload = {
        space_id: spaceId,
        booker_type: "visitor",
        visitor_name: visitorName.trim(),
        visitor_email: visitorEmail.trim().toLowerCase(),
        start_at: startIso,
        end_at: endIso,
        purpose: purpose.trim() || null,
        attendee_count: attendeeCount,
      };
      if (!insertPayload.visitor_name || !insertPayload.visitor_email) {
        setError("Visitor name and email are required.");
        setSaving(false);
        return;
      }
    } else {
      if (!memberUserId) {
        setError("Select a person to book for.");
        setSaving(false);
        return;
      }
      insertPayload = {
        space_id: spaceId,
        booker_type: "registered_user",
        booker_user_id: memberUserId,
        start_at: startIso,
        end_at: endIso,
        purpose: purpose.trim() || null,
        attendee_count: attendeeCount,
      };
    }

    const { data, error: insErr } = await supabase
      .from("bookings")
      .insert(insertPayload as never)
      .select("id, status, total_price")
      .maybeSingle();

    if (insErr || !data) {
      setError(insErr?.message ?? "Could not create booking.");
      setSaving(false);
      return;
    }

    const row = data as { id: string; status: string; total_price: number };

    try {
      const emailBody: Record<string, unknown> = { bookingId: row.id, kind: "created" };
      const isOwnerManagerOnBehalf =
        showOnBehalfTenantEmailField && (bookerMode === "visitor" || bookerMode === "member");
      if (isOwnerManagerOnBehalf && onBehalfTenantEmail.trim()) {
        emailBody.onBehalfTenantEmail = onBehalfTenantEmail.trim();
      }
      await fetch("/api/bookings/email", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailBody),
      });
    } catch {
      /* non-fatal */
    }

    setMessage(
      row.status === "pending"
        ? `Request submitted (pending approval). Total ${row.total_price}. Reference ${row.id.slice(0, 8)}…`
        : `Booking confirmed. Total ${row.total_price}. Reference ${row.id.slice(0, 8)}…`
    );
    setSaving(false);
  }

  if (loading) {
    return <p>Loading...</p>;
  }

  return (
    <div>
      <h1 style={{ margin: "0 0 8px" }}>Make a booking</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Pick an available space. Instant confirmation applies when the space does not require approval.
      </p>

      {!canCreate ? (
        <p style={{ color: "#b00020" }}>
          Your role cannot create bookings. Ask an owner or manager, or use the visitor link if you are a guest.
        </p>
      ) : (
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 16, maxWidth: 520, marginTop: 16 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Property</span>
            <select
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              required
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

          <label style={{ display: "grid", gap: 6 }}>
            <span>Space</span>
            <select
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
              required
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            >
              {spaces.length === 0 ? <option value="">No available spaces</option> : null}
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {spaceTypeLabel(s.space_type)} · {s.hourly_price}/hr
                  {s.requires_approval ? " · needs approval" : ""}
                </option>
              ))}
            </select>
          </label>

          {canBookForOthers ? (
            <fieldset style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
              <legend style={{ fontSize: 14 }}>Book for</legend>
              <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <input
                  type="radio"
                  name="booker"
                  checked={bookerMode === "self"}
                  onChange={() => setBookerMode("self")}
                />
                Yourself
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <input
                  type="radio"
                  name="booker"
                  checked={bookerMode === "visitor"}
                  onChange={() => setBookerMode("visitor")}
                />
                Outside visitor (name + email)
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="radio"
                  name="booker"
                  checked={bookerMode === "member"}
                  onChange={() => setBookerMode("member")}
                />
                Registered tenant user
              </label>
              {bookerMode === "visitor" ? (
                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                  <input
                    placeholder="Visitor name"
                    value={visitorName}
                    onChange={(e) => setVisitorName(e.target.value)}
                    style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                  />
                  <input
                    placeholder="Visitor email"
                    type="email"
                    value={visitorEmail}
                    onChange={(e) => setVisitorEmail(e.target.value)}
                    style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                  />
                </div>
              ) : null}
              {bookerMode === "member" ? (
                <select
                  value={memberUserId}
                  onChange={(e) => setMemberUserId(e.target.value)}
                  style={{ marginTop: 12, padding: 10, borderRadius: 8, border: "1px solid #ddd", width: "100%" }}
                  required={bookerMode === "member"}
                >
                  <option value="">Select user…</option>
                  {tenantUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name ?? u.email}
                    </option>
                  ))}
                </select>
              ) : null}
              {showOnBehalfTenantEmailField && (bookerMode === "visitor" || bookerMode === "member") ? (
                <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
                  <span>Tenant email (optional)</span>
                  <input
                    type="email"
                    placeholder="Send a copy of the confirmation to this address"
                    value={onBehalfTenantEmail}
                    onChange={(e) => setOnBehalfTenantEmail(e.target.value)}
                    style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                  />
                  <span style={{ fontSize: 12, color: "#666" }}>
                    The visitor or selected member always receives a confirmation. Use this for an extra copy (e.g.
                    internal tenant contact).
                  </span>
                </label>
              ) : null}
            </fieldset>
          ) : null}

          <label style={{ display: "grid", gap: 6 }}>
            <span>Start</span>
            <input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              required
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>End</span>
            <input
              type="datetime-local"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
              required
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Purpose / description</span>
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={3}
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Attendees</span>
            <input
              type="number"
              min={1}
              value={attendeeCount}
              onChange={(e) => setAttendeeCount(Number(e.target.value) || 1)}
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </label>

          {error ? <p style={{ color: "#b00020", margin: 0 }}>{error}</p> : null}
          {message ? <p style={{ color: "#1b5e20", margin: 0 }}>{message}</p> : null}

          <button
            type="submit"
            disabled={saving || spaces.length === 0}
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Submit booking"}
          </button>
        </form>
      )}
    </div>
  );
}
