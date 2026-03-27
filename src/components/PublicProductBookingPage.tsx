"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { spaceTypeLabel } from "@/lib/rooms/labels";

type SpaceRow = {
  id: string;
  property_id: string;
  name: string;
  space_type: string;
  hourly_price: number | null;
  half_day_price_eur: number | null;
  full_day_price_eur: number | null;
  daily_price_eur: number | null;
  requires_approval: boolean | null;
  space_status: string | null;
  properties?: { name: string | null; city: string | null }[] | { name: string | null; city: string | null } | null;
};

export default function PublicProductBookingPage({
  title,
  allowedTypes,
  inquiryDefault,
}: {
  title: string;
  allowedTypes: string[];
  inquiryDefault?: boolean;
}) {
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [spaceId, setSpaceId] = useState("");
  const [visitorName, setVisitorName] = useState("");
  const [visitorEmail, setVisitorEmail] = useState("");
  const [purpose, setPurpose] = useState("");
  const [attendeeCount, setAttendeeCount] = useState(1);
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [mode, setMode] = useState<"instant" | "inquiry">(inquiryDefault ? "inquiry" : "instant");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("bookable_spaces")
        .select("id,property_id,name,space_type,hourly_price,half_day_price_eur,full_day_price_eur,daily_price_eur,requires_approval,space_status,properties(name,city)")
        .in("space_type", allowedTypes)
        .eq("space_status", "available")
        .order("name", { ascending: true });
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setSpaces([]);
      } else {
        const list = (data ?? []) as SpaceRow[];
        setSpaces(list);
        setSpaceId((prev) => (prev && list.some((s) => s.id === prev) ? prev : list[0]?.id ?? ""));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [allowedTypes]);

  const selected = useMemo(() => spaces.find((s) => s.id === spaceId) ?? null, [spaceId, spaces]);
  const propertyOf = (s: SpaceRow): { name: string | null; city: string | null } | null => {
    const p = s.properties;
    if (!p) return null;
    if (Array.isArray(p)) return p[0] ?? null;
    return p;
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    if (!selected) {
      setError("Choose a space first.");
      return;
    }
    if (!startLocal || !endLocal || !visitorName.trim() || !visitorEmail.trim()) {
      setError("Fill all required fields.");
      return;
    }
    setSaving(true);
    const modePrefix = mode === "inquiry" ? "[INQUIRY] " : "";
    const res = await fetch("/api/bookings/public", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: selected.property_id,
        spaceId: selected.id,
        startAt: new Date(startLocal).toISOString(),
        endAt: new Date(endLocal).toISOString(),
        visitorName: visitorName.trim(),
        visitorEmail: visitorEmail.trim(),
        purpose: `${modePrefix}${purpose.trim()}`.trim() || modePrefix.trim(),
        attendeeCount: Math.max(1, attendeeCount),
      }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; booking?: { status?: string; total_price?: number } };
    setSaving(false);
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Could not submit request.");
      return;
    }
    if (mode === "inquiry" || json.booking?.status === "pending") {
      setMsg("Inquiry sent. Our team will review and confirm pricing/availability.");
    } else {
      setMsg(`Booking submitted. Total EUR ${Number(json.booking?.total_price ?? 0).toFixed(2)}.`);
    }
  }

  return (
    <main style={{ maxWidth: 720, display: "grid", gap: 12 }}>
      <h1 style={{ margin: 0 }}>{title}</h1>
      <p style={{ margin: 0, color: "#556" }}>
        Browse available spaces and submit an instant booking or inquiry without signing in.
      </p>
      {error ? <p style={{ color: "#b00020", margin: 0 }}>{error}</p> : null}
      {msg ? <p style={{ color: "#1b5e20", margin: 0 }}>{msg}</p> : null}
      {loading ? (
        <p>Loading spaces...</p>
      ) : (
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 10, background: "#fff", border: "1px solid #dce8e8", borderRadius: 12, padding: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Space</span>
            <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)} required style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {spaceTypeLabel(s.space_type)} · {(propertyOf(s)?.name ?? "Property")}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <div style={{ fontSize: 13, color: "#445" }}>
              Pricing: {selected.hourly_price != null ? `EUR ${selected.hourly_price}/h` : "—"}
              {selected.half_day_price_eur != null ? ` · Half-day EUR ${selected.half_day_price_eur}` : ""}
              {selected.full_day_price_eur != null ? ` · Full-day EUR ${selected.full_day_price_eur}` : ""}
              {selected.daily_price_eur != null ? ` · Daily EUR ${selected.daily_price_eur}` : ""}
              {selected.requires_approval ? " · Requires approval" : " · Instant booking available"}
            </div>
          ) : null}
          <label style={{ display: "grid", gap: 6 }}>
            <span>Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as "instant" | "inquiry")} style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}>
              <option value="instant">Instant booking</option>
              <option value="inquiry">Inquiry / custom quote</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Your name</span>
            <input value={visitorName} onChange={(e) => setVisitorName(e.target.value)} required style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Email</span>
            <input type="email" value={visitorEmail} onChange={(e) => setVisitorEmail(e.target.value)} required style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Start</span>
              <input type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} required style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>End</span>
              <input type="datetime-local" value={endLocal} onChange={(e) => setEndLocal(e.target.value)} required style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
            </label>
          </div>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Attendees</span>
            <input type="number" min={1} value={attendeeCount} onChange={(e) => setAttendeeCount(Number(e.target.value) || 1)} style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Notes</span>
            <textarea rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }} />
          </label>
          <button type="submit" disabled={saving || !spaces.length} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #1a5c5a", background: "#1a5c5a", color: "#fff" }}>
            {saving ? "Submitting..." : mode === "inquiry" ? "Send inquiry" : "Book now"}
          </button>
        </form>
      )}
      <p style={{ margin: 0, fontSize: 14 }}>
        <Link href="/login">Staff sign in</Link>
      </p>
    </main>
  );
}

