"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCustomerPortal } from "@/context/CustomerPortalContext";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { createRoomPhotoSignedUrlMap } from "@/lib/storage/room-photo-signed-url";
import { spaceTypeLabel } from "@/lib/bookings/status-style";
import { normalizeSpaceTypeKey } from "@/lib/bookings/space-availability";

const PETROL = "#0D4F4F";

type RoomPhoto = { storage_path: string; sort_order?: number };
type SpaceRow = {
  id: string;
  name: string;
  space_type: string;
  capacity: number;
  hourly_price: number;
  space_status: string;
  is_published?: boolean | null;
  room_photos?: RoomPhoto[] | null;
};

function localRangeToIso(dateStr: string, startHm: string, endHm: string): { startIso: string; endIso: string } | null {
  const start = new Date(`${dateStr}T${startHm}:00`);
  const end = new Date(`${dateStr}T${endHm}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function durationLabel(hours: number): string {
  if (hours <= 0) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return new Date(aStart) < new Date(bEnd) && new Date(bEnd) > new Date(aStart);
}

export default function CustomerPortalMakeBookingPage() {
  const { customerUser, company, loading: ctxLoading } = useCustomerPortal();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const propertyId = (company?.property_id as string | null | undefined) ?? null;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [signedPhotoUrls, setSignedPhotoUrls] = useState<Map<string, string>>(new Map());
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<SpaceRow | null>(null);

  const [dateStr, setDateStr] = useState("");
  const [startHm, setStartHm] = useState("09:00");
  const [durationHours, setDurationHours] = useState(1);
  const [notes, setNotes] = useState("");

  const [busySlots, setBusySlots] = useState<{ start_at: string; end_at: string }[]>([]);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [doneBooking, setDoneBooking] = useState<{ id: string; status: string; total_price: number } | null>(null);

  const timeOptions = useMemo(() => {
    const out: string[] = [];
    for (let h = 7; h <= 21; h++) {
      for (const m of [0, 30]) {
        if (h === 21 && m > 0) break;
        out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
    return out;
  }, []);

  const durationOptions = useMemo(() => [0.5, 1, 1.5, 2, 3, 4, 6, 8], []);

  const loadSpaces = useCallback(async () => {
    if (!propertyId) {
      setSpaces([]);
      setSignedPhotoUrls(new Map());
      return;
    }
    setLoadErr(null);
    const { data, error } = await supabase
      .from("bookable_spaces")
      .select("id, name, space_type, capacity, hourly_price, space_status, is_published, room_photos(storage_path, sort_order)")
      .eq("property_id", propertyId)
      .in("space_status", ["available", "vacant", "active"])
      .eq("is_published", true)
      .not("space_type", "eq", "office")
      .order("name", { ascending: true });

    if (error) {
      setLoadErr(error.message);
      setSpaces([]);
      return;
    }
    const raw = (data ?? []) as SpaceRow[];
    setSpaces(
      raw.filter((s) => normalizeSpaceTypeKey(s.space_type) !== "office" && s.is_published !== false),
    );
  }, [propertyId, supabase]);

  useEffect(() => {
    void loadSpaces();
  }, [loadSpaces]);

  const preview = useMemo(() => {
    if (!dateStr || !selected) return null;
    const endHmDate = new Date(`${dateStr}T${startHm}:00`);
    endHmDate.setMinutes(endHmDate.getMinutes() + Math.round(durationHours * 60));
    const endHm = `${String(endHmDate.getHours()).padStart(2, "0")}:${String(endHmDate.getMinutes()).padStart(2, "0")}`;
    const range = localRangeToIso(dateStr, startHm, endHm);
    if (!range) return null;
    const hours =
      (new Date(range.endIso).getTime() - new Date(range.startIso).getTime()) / 3600000;
    const price = Math.round(Number(selected.hourly_price) * hours * 100) / 100;
    return { ...range, hours, price, endHm };
  }, [dateStr, startHm, durationHours, selected]);

  useEffect(() => {
    if (!selected?.id || !dateStr) {
      setBusySlots([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const dayStart = new Date(`${dateStr}T00:00:00`);
      const nextDay = new Date(dayStart);
      nextDay.setDate(nextDay.getDate() + 1);
      const { data, error } = await supabase
        .from("bookings")
        .select("start_at, end_at, status")
        .eq("space_id", selected.id)
        .in("status", ["pending", "confirmed"])
        .lt("start_at", nextDay.toISOString())
        .gt("end_at", dayStart.toISOString());
      if (cancelled) return;
      if (error) {
        setBusySlots([]);
        return;
      }
      setBusySlots(
        (data ?? []).map((r: { start_at: string; end_at: string }) => ({
          start_at: r.start_at,
          end_at: r.end_at,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.id, dateStr, supabase]);

  const slotConflict = useMemo(() => {
    if (!preview || !selected) return false;
    return busySlots.some((b) => overlaps(preview.startIso, preview.endIso, b.start_at, b.end_at));
  }, [preview, busySlots, selected]);

  async function onConfirmSubmit() {
    if (!customerUser || !selected || !preview || slotConflict) return;
    setSubmitErr(null);
    setSubmitting(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSubmitErr("Not signed in.");
      setSubmitting(false);
      return;
    }

    const { data, error } = await supabase
      .from("bookings")
      .insert({
        space_id: selected.id,
        start_at: preview.startIso,
        end_at: preview.endIso,
        booker_type: "registered_user",
        booker_user_id: user.id,
        customer_user_id: customerUser.id,
        purpose: notes.trim() || null,
        attendee_count: 1,
      } as never)
      .select("id, status, total_price")
      .maybeSingle();

    setSubmitting(false);
    if (error || !data) {
      setSubmitErr(error?.message ?? "Could not create booking.");
      return;
    }
    setDoneBooking(data as { id: string; status: string; total_price: number });
  }

  if (ctxLoading) {
    return <p style={{ color: "#64748b" }}>Loading…</p>;
  }

  if (doneBooking) {
    return (
      <div style={{ maxWidth: 520 }}>
        <h1 style={{ marginTop: 0, fontSize: 26, fontWeight: 700, color: PETROL }}>Booking confirmed</h1>
        <div
          style={{
            background: "#ecfdf5",
            border: "1px solid #a7f3d0",
            borderRadius: 12,
            padding: 20,
            marginTop: 12,
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600, color: "#065f46" }}>Thank you — your booking is saved.</p>
          <p style={{ margin: "8px 0", color: "#047857" }}>
            <strong>Reference:</strong> {doneBooking.id}
          </p>
          <p style={{ margin: "8px 0", color: "#047857" }}>
            <strong>Status:</strong> {doneBooking.status}
          </p>
          <p style={{ margin: "8px 0", color: "#047857" }}>
            <strong>Total:</strong> €{Number(doneBooking.total_price).toFixed(2)}
          </p>
        </div>
        <button
          type="button"
          className="vw-btn-primary"
          style={{ marginTop: 16 }}
          onClick={() => {
            setDoneBooking(null);
            setStep(1);
            setSelected(null);
            setNotes("");
            setDateStr("");
            void loadSpaces();
          }}
        >
          Make another booking
        </button>
      </div>
    );
  }

  if (!propertyId) {
    return (
      <div>
        <h1 style={{ marginTop: 0, fontSize: 26, fontWeight: 700, color: PETROL }}>Make booking</h1>
        <p style={{ color: "#b45309" }}>
          Your company is not linked to a property yet. Contact your workspace provider to enable bookings.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 960 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: PETROL }}>Make booking</h1>
        <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 14 }}>
          Step {step} of 3 — choose a space, pick a time, then confirm.
        </p>
      </div>

      {loadErr ? <p style={{ color: "#b91c1c" }}>{loadErr}</p> : null}

      {step === 1 && (
        <div style={{ display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: PETROL }}>1. Select a space</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 14,
            }}
          >
            {spaces.map((s) => {
              const photos = Array.isArray(s.room_photos)
                ? [...s.room_photos].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                : [];
              const firstPath = photos[0]?.storage_path;
              const img = firstPath ? signedPhotoUrls.get(firstPath) ?? null : null;
              const picked = selected?.id === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelected(s)}
                  style={{
                    textAlign: "left",
                    padding: 0,
                    borderRadius: 12,
                    border: picked ? `2px solid ${PETROL}` : "1px solid #e5e7eb",
                    background: "#fff",
                    cursor: "pointer",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ position: "relative", height: 120, background: "#f1f5f9" }}>
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                      <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ padding: 16, color: "#94a3b8", fontSize: 13 }}>No photo</div>
                    )}
                  </div>
                  <div style={{ padding: 12 }}>
                    <div style={{ fontWeight: 700, color: PETROL, fontSize: 15 }}>{s.name}</div>
                    <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>{spaceTypeLabel(s.space_type)}</div>
                    <div style={{ fontSize: 13, color: "#475569", marginTop: 6 }}>
                      Capacity {s.capacity} · €{Number(s.hourly_price).toFixed(2)}/h
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {spaces.length === 0 && !loadErr ? (
            <p style={{ color: "#64748b" }}>No bookable spaces found for your property.</p>
          ) : null}
          <div>
            <button
              type="button"
              className="vw-btn-primary"
              disabled={!selected}
              onClick={() => setStep(2)}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 2 && selected && (
        <div style={{ display: "grid", gap: 14, maxWidth: 420 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: PETROL }}>2. Date & time</h2>
          <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500 }}>
            Date
            <input
              type="date"
              className="vw-input"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
            />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500 }}>
            Start time
            <select className="vw-input" value={startHm} onChange={(e) => setStartHm(e.target.value)}>
              {timeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500 }}>
            Duration
            <select
              className="vw-input"
              value={String(durationHours)}
              onChange={(e) => setDurationHours(Number(e.target.value))}
            >
              {durationOptions.map((d) => (
                <option key={d} value={d}>
                  {durationLabel(d)}
                </option>
              ))}
            </select>
          </label>
          {preview ? (
            <p style={{ fontSize: 14, color: "#475569" }}>
              Ends at <strong>{preview.endHm}</strong> · {durationLabel(preview.hours)} · estimated{" "}
              <strong>€{preview.price.toFixed(2)}</strong>
            </p>
          ) : null}
          {slotConflict ? (
            <p style={{ color: "#b91c1c", fontSize: 14 }}>This slot overlaps an existing booking. Choose another time.</p>
          ) : null}
          <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500 }}>
            Notes (optional)
            <textarea
              className="vw-input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Purpose or special requirements"
            />
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="vw-btn-secondary" onClick={() => setStep(1)}>
              Back
            </button>
            <button
              type="button"
              className="vw-btn-primary"
              disabled={!dateStr || !preview || slotConflict}
              onClick={() => setStep(3)}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && selected && preview && (
        <div style={{ display: "grid", gap: 14, maxWidth: 480 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: PETROL }}>3. Confirm</h2>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 16,
              fontSize: 14,
              color: "#334155",
            }}
          >
            <p style={{ margin: "0 0 8px" }}>
              <strong>Space:</strong> {selected.name}
            </p>
            <p style={{ margin: "8px 0" }}>
              <strong>Date:</strong> {dateStr}
            </p>
            <p style={{ margin: "8px 0" }}>
              <strong>Time:</strong> {startHm} – {preview.endHm}
            </p>
            <p style={{ margin: "8px 0" }}>
              <strong>Duration:</strong> {durationLabel(preview.hours)}
            </p>
            <p style={{ margin: "8px 0" }}>
              <strong>Total:</strong> €{preview.price.toFixed(2)}
            </p>
            {notes.trim() ? (
              <p style={{ margin: "8px 0 0" }}>
                <strong>Notes:</strong> {notes.trim()}
              </p>
            ) : null}
          </div>
          {submitErr ? <p style={{ color: "#b91c1c" }}>{submitErr}</p> : null}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="vw-btn-secondary" onClick={() => setStep(2)} disabled={submitting}>
              Back
            </button>
            <button
              type="button"
              className="vw-btn-primary"
              onClick={() => void onConfirmSubmit()}
              disabled={submitting || slotConflict}
            >
              {submitting ? "Booking…" : "Confirm booking"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
