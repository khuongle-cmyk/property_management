"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { spaceTypeLabel } from "@/lib/bookings/status-style";

type SpaceRow = {
  id: string;
  name: string;
  space_type: string;
  hourly_price: number;
  requires_approval: boolean;
};

function PublicBookingForm() {
  const searchParams = useSearchParams();
  const propertyId = searchParams.get("propertyId")?.trim() ?? "";
  const propertyName = searchParams.get("name")?.trim() ?? "";

  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const [spaceId, setSpaceId] = useState("");
  const [visitorName, setVisitorName] = useState("");
  const [visitorEmail, setVisitorEmail] = useState("");
  const [purpose, setPurpose] = useState("");
  const [attendeeCount, setAttendeeCount] = useState(1);
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");

  const loadSpaces = useCallback(async () => {
    if (!propertyId) {
      setSpaces([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("bookable_spaces")
      .select("id, name, space_type, hourly_price, requires_approval, space_status")
      .eq("property_id", propertyId)
      .eq("space_status", "available")
      .not("space_type", "eq", "office")
      .order("name", { ascending: true });

    if (error) {
      setLoadError(error.message);
      setSpaces([]);
    } else {
      const list = (data as SpaceRow[]) ?? [];
      setSpaces(list);
      setSpaceId((prev) => {
        if (prev && list.some((s) => s.id === prev)) return prev;
        return list[0]?.id ?? "";
      });
    }
    setLoading(false);
  }, [propertyId]);

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setDoneMessage(null);
    if (!propertyId) {
      setFormError("Missing property link. Ask the host for the full booking URL.");
      return;
    }
    if (!spaceId || !startLocal || !endLocal) {
      setFormError("Choose a space and time range.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/bookings/public", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId,
        spaceId,
        startAt: new Date(startLocal).toISOString(),
        endAt: new Date(endLocal).toISOString(),
        visitorName: visitorName.trim(),
        visitorEmail: visitorEmail.trim(),
        purpose: purpose.trim() || undefined,
        attendeeCount,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; booking?: { status: string; total_price: number } };
    setSaving(false);
    if (!res.ok || !json.ok) {
      setFormError(json.error ?? "Request failed");
      return;
    }
    const st = json.booking?.status;
    const pr = json.booking?.total_price;
    setDoneMessage(
      st === "pending"
        ? `Thanks — your request is pending approval. Total ${pr}. Check your email.`
        : `You are confirmed. Total ${pr}. Check your email for the calendar invite.`
    );
  }

  if (!propertyId) {
    return (
      <main style={{ maxWidth: 560 }}>
        <h1 style={{ margin: "0 0 8px" }}>Book a space</h1>
        <p style={{ color: "#555" }}>
          This page needs a property link. Your host should share a URL that includes{" "}
          <code style={{ background: "#f4f4f4", padding: "2px 6px", borderRadius: 4 }}>propertyId=…</code>
        </p>
        <p>
          <Link href="/login">Staff sign in</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 560 }}>
      <h1 style={{ margin: "0 0 8px" }}>Book a space</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        {propertyName || "Visitor booking"} — no account required.
      </p>
      <p style={{ margin: "6px 0 0", fontSize: 14 }}>
        Browse by product:{" "}
        <Link href="/book/meeting-rooms">Meeting rooms</Link>
        {" · "}
        <Link href="/book/venues">Venues</Link>
        {" · "}
        <Link href="/book/coworking">Coworking / Hot desks</Link>
      </p>

      {loadError ? <p style={{ color: "#b00020" }}>{loadError}</p> : null}
      {loading ? (
        <p>Loading spaces…</p>
      ) : (
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 14, marginTop: 16 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Space</span>
            <select
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
              required
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            >
              {spaces.length === 0 ? <option value="">No spaces available</option> : null}
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {spaceTypeLabel(s.space_type)} · {s.hourly_price}/hr
                  {s.requires_approval ? " · pending approval" : ""}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Your name</span>
            <input
              value={visitorName}
              onChange={(e) => setVisitorName(e.target.value)}
              required
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Email</span>
            <input
              type="email"
              value={visitorEmail}
              onChange={(e) => setVisitorEmail(e.target.value)}
              required
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </label>

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
            <span>Purpose (optional)</span>
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

          {formError ? <p style={{ color: "#b00020", margin: 0 }}>{formError}</p> : null}
          {doneMessage ? <p style={{ color: "#1b5e20", margin: 0 }}>{doneMessage}</p> : null}

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
            {saving ? "Submitting…" : "Request booking"}
          </button>
        </form>
      )}

      <p style={{ marginTop: 24, fontSize: 14 }}>
        <Link href="/login">Staff sign in</Link>
      </p>
    </main>
  );
}

export default function PublicBookingPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <PublicBookingForm />
    </Suspense>
  );
}
