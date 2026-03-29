"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Calendar,
  dateFnsLocalizer,
  type EventPropGetter,
  type SlotInfo,
  type View,
  Views,
} from "react-big-calendar";
import {
  addDays,
  differenceInMinutes,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  getDay,
  isSameDay,
  parse,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { enGB } from "date-fns/locale/en-GB";
import type { Locale } from "date-fns";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { getSupabaseClient } from "@/lib/supabase/browser";
import {
  isHourlyBookableSpaceStatus,
  isSpacePublishedForBooking,
  normalizeSpaceTypeKey,
} from "@/lib/bookings/space-availability";
import { spaceTypeLabel } from "@/lib/bookings/status-style";
import { loadScopedPropertiesForUser } from "@/lib/properties/scoped";

const locales = { "en-GB": enGB };

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date, options?: { locale?: Locale }) =>
    startOfWeek(date, { ...options, weekStartsOn: 1, locale: options?.locale ?? enGB }),
  getDay,
  locales,
});

const MIN_TIME = new Date(1970, 0, 1, 6, 0, 0);
const MAX_TIME = new Date(1970, 0, 1, 21, 0, 0);

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

type BookingRow = {
  id: string;
  space_id: string;
  start_at: string;
  end_at: string;
  status: string;
  purpose: string | null;
  booker_type: string;
  booker_user_id: string | null;
  visitor_name: string | null;
  visitor_email: string | null;
  bookable_spaces: { name: string; space_type: string } | null;
  tenants: { name: string | null } | null;
};

type TenantUser = { id: string; email: string; display_name: string | null };

type CalEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resourceId?: string;
  booking: BookingRow;
};

export type SpaceTypeFilter = "all" | "meeting_room" | "hot_desk" | "office" | "venue";

function spaceMatchesFilter(spaceType: string, filter: SpaceTypeFilter): boolean {
  if (filter === "all") return true;
  const t = normalizeSpaceTypeKey(spaceType);
  if (filter === "meeting_room") {
    return (
      t === "meeting_room" ||
      t === "conference_room" ||
      t === "meetingroom" ||
      (t.includes("meeting") && !t.includes("office"))
    );
  }
  if (filter === "hot_desk") return t === "hot_desk" || t === "desk";
  if (filter === "office") return t === "office";
  if (filter === "venue") return t === "venue";
  return true;
}

function eventColors(spaceType: string): { bg: string; fg: string } {
  const t = (spaceType || "").toLowerCase();
  if (t === "meeting_room" || t === "conference_room") return { bg: "#3aafa9", fg: "#fff" };
  if (t === "hot_desk" || t === "desk") return { bg: "#f4a261", fg: "#1a1a1a" };
  if (t === "office") return { bg: "#1a4a4a", fg: "#fff" };
  if (t === "venue") return { bg: "#7c3aed", fg: "#fff" };
  return { bg: "#64748b", fg: "#fff" };
}

function fetchRangeForView(date: Date, view: View): { start: Date; end: Date } {
  if (view === Views.MONTH) {
    return { start: startOfMonth(date), end: endOfMonth(date) };
  }
  if (view === Views.WEEK) {
    return {
      start: startOfWeek(date, { weekStartsOn: 1 }),
      end: endOfWeek(date, { weekStartsOn: 1 }),
    };
  }
  return { start: startOfDay(date), end: endOfDay(date) };
}

function bookingToEvents(b: BookingRow, userMap: Record<string, TenantUser>): CalEvent[] {
  const space = b.bookable_spaces;
  const st = space?.space_type ?? "";
  let tenantLine = "";
  if (b.booker_type === "visitor") {
    tenantLine = b.visitor_name ?? b.visitor_email ?? "Visitor";
  } else if (b.booker_user_id) {
    const u = userMap[b.booker_user_id];
    tenantLine = u ? (u.display_name ?? u.email) : b.booker_user_id.slice(0, 8) + "…";
  } else {
    tenantLine = b.tenants?.name ?? "—";
  }
  const title = `${space?.name ?? "Space"} · ${tenantLine}`;
  return [
    {
      id: b.id,
      title,
      start: new Date(b.start_at),
      end: new Date(b.end_at),
      resourceId: b.space_id,
      booking: b,
    },
  ];
}

export default function BookingCalendarView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [userMap, setUserMap] = useState<Record<string, TenantUser>>({});
  const [roles, setRoles] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const [view, setView] = useState<View>(Views.WEEK);
  const [date, setDate] = useState(new Date());
  const [nowTick, setNowTick] = useState(() => new Date());
  const [spaceTypeFilter, setSpaceTypeFilter] = useState<SpaceTypeFilter>("all");
  const [focusSpaceId, setFocusSpaceId] = useState<string | null>(null);

  const [slotModal, setSlotModal] = useState<{
    start: Date;
    end: Date;
    resourceId?: string;
  } | null>(null);
  const [detailBooking, setDetailBooking] = useState<BookingRow | null>(null);

  const [modalSpaceId, setModalSpaceId] = useState("");
  const [modalName, setModalName] = useState("");
  const [modalEmail, setModalEmail] = useState("");
  const [modalNotes, setModalNotes] = useState("");
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [detailActing, setDetailActing] = useState(false);

  const canCreate = useMemo(
    () => roles.some((r) => ["super_admin", "owner", "manager", "tenant"].includes(r)),
    [roles],
  );

  const canManage = useMemo(
    () => roles.some((r) => ["owner", "manager", "super_admin"].includes(r)),
    [roles],
  );

  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === propertyId),
    [properties, propertyId],
  );

  const bookableSpacesForModal = useMemo(() => {
    return spaces.filter(
      (s) =>
        spaceMatchesFilter(s.space_type, spaceTypeFilter) &&
        isHourlyBookableSpaceStatus(s.space_status) &&
        isSpacePublishedForBooking(s.is_published) &&
        normalizeSpaceTypeKey(s.space_type) !== "office",
    );
  }, [spaces, spaceTypeFilter]);

  const filteredSpacesForResources = useMemo(() => {
    return spaces.filter((s) => spaceMatchesFilter(s.space_type, spaceTypeFilter));
  }, [spaces, spaceTypeFilter]);

  const resources = useMemo(() => {
    if (view !== Views.DAY) return undefined;
    const cols = filteredSpacesForResources.map((s) => ({ id: s.id, title: s.name }));
    if (focusSpaceId) {
      const one = cols.find((c) => c.id === focusSpaceId);
      return one ? [one] : cols;
    }
    return cols;
  }, [view, filteredSpacesForResources, focusSpaceId]);

  const events = useMemo(() => {
    const list: CalEvent[] = [];
    for (const b of bookings) {
      const st = b.bookable_spaces?.space_type ?? "";
      if (!spaceMatchesFilter(st, spaceTypeFilter)) continue;
      list.push(...bookingToEvents(b, userMap));
    }
    return list;
  }, [bookings, userMap, spaceTypeFilter]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

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
    const { data: memberships, error: mErr } = await supabase
      .from("memberships")
      .select("tenant_id, role")
      .eq("user_id", user.id);
    if (mErr) throw new Error(mErr.message);
    setRoles((memberships ?? []).map((m) => (m.role ?? "").toLowerCase()));
    const scoped = await loadScopedPropertiesForUser(supabase, user.id);
    const list = (scoped.properties as PropertyRow[]) ?? [];
    setProperties(list);
    setPropertyId((prev) => prev || list[0]?.id || "");
  }, [router]);

  const loadSpaces = useCallback(async (pid: string) => {
    if (!pid) {
      setSpaces([]);
      return;
    }
    const supabase = getSupabaseClient();
    const { data, error: sErr } = await supabase
      .from("bookable_spaces")
      .select("id, name, space_type, hourly_price, requires_approval, space_status, is_published")
      .eq("property_id", pid)
      .order("name", { ascending: true });
    if (sErr) throw new Error(sErr.message);
    setSpaces((data as SpaceRow[]) ?? []);
  }, []);

  const loadBookings = useCallback(
    async (pid: string, range: { start: Date; end: Date }) => {
      if (!pid) {
        setBookings([]);
        return;
      }
      const supabase = getSupabaseClient();
      const padStart = addDays(range.start, -1);
      const padEnd = addDays(range.end, 1);
      const { data, error: bErr } = await supabase
        .from("bookings")
        .select(
          `
          id,
          space_id,
          start_at,
          end_at,
          status,
          purpose,
          booker_type,
          booker_user_id,
          visitor_name,
          visitor_email,
          bookable_spaces ( name, space_type ),
          tenants ( name )
        `,
        )
        .eq("property_id", pid)
        .lt("start_at", padEnd.toISOString())
        .gt("end_at", padStart.toISOString())
        .order("start_at", { ascending: true });
      if (bErr) throw new Error(bErr.message);
      setBookings((data as unknown as BookingRow[]) ?? []);
    },
    [],
  );

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

  const range = useMemo(() => fetchRangeForView(date, view), [date, view]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!propertyId) return;
      setError(null);
      try {
        await loadBookings(propertyId, range);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load bookings");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId, range, loadBookings]);

  useEffect(() => {
    if (!canManage || !selectedProperty?.tenant_id) {
      setUserMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/bookings/tenant-users?tenantId=${encodeURIComponent(selectedProperty.tenant_id)}`,
        { credentials: "include" },
      );
      const json = (await res.json()) as { users?: TenantUser[] };
      if (!res.ok || cancelled) return;
      const map: Record<string, TenantUser> = {};
      for (const u of json.users ?? []) map[u.id] = u;
      if (!cancelled) setUserMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage, selectedProperty?.tenant_id]);

  useEffect(() => {
    const qp = searchParams.get("propertyId")?.trim();
    if (!qp || properties.length === 0) return;
    if (properties.some((p) => p.id === qp)) setPropertyId(qp);
  }, [searchParams, properties]);

  const spaceIdQs = searchParams.get("spaceId")?.trim() ?? "";

  useEffect(() => {
    if (spaceIdQs) {
      setFocusSpaceId(spaceIdQs);
      setView(Views.DAY);
    } else {
      setFocusSpaceId(null);
    }
  }, [spaceIdQs]);

  useEffect(() => {
    if (!spaceIdQs || spaces.length === 0) return;
    const sp = spaces.find((s) => s.id === spaceIdQs);
    if (!sp) return;
    const t = (sp.space_type || "").toLowerCase();
    if (t === "meeting_room" || t === "conference_room") setSpaceTypeFilter("meeting_room");
    else if (t === "hot_desk" || t === "desk") setSpaceTypeFilter("hot_desk");
    else if (t === "office") setSpaceTypeFilter("office");
    else if (t === "venue") setSpaceTypeFilter("venue");
    else setSpaceTypeFilter("all");
  }, [spaceIdQs, spaces]);

  useEffect(() => {
    if (!slotModal) return;
    const preferred = slotModal.resourceId;
    const list = bookableSpacesForModal;
    if (preferred && list.some((s) => s.id === preferred)) {
      setModalSpaceId(preferred);
    } else {
      setModalSpaceId(list[0]?.id ?? "");
    }
    setModalName("");
    setModalEmail("");
    setModalNotes("");
    setModalError(null);
  }, [slotModal, bookableSpacesForModal]);

  const eventPropGetter: EventPropGetter<CalEvent> = useCallback((ev) => {
    const st = ev.booking.bookable_spaces?.space_type ?? "";
    const { bg, fg } = eventColors(st);
    return {
      style: {
        backgroundColor: bg,
        color: fg,
        border: "none",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
      },
    };
  }, []);

  const slotPropGetter = useCallback((d: Date) => {
    const mins = d.getHours() * 60 + d.getMinutes();
    const eight = 8 * 60;
    const eighteen = 18 * 60;
    if (mins < eight || mins >= eighteen) {
      return { className: "vw-cal-slot-offhours" };
    }
    return {};
  }, []);

  const dayPropGetter = useCallback((d: Date) => {
    if (isSameDay(d, new Date())) {
      return { className: "vw-cal-today-cell" };
    }
    return {};
  }, []);

  function handleSelectSlot(slot: SlotInfo) {
    if (!canCreate) return;
    setSlotModal({
      start: slot.start,
      end: slot.end,
      resourceId: slot.resourceId as string | undefined,
    });
  }

  function handleSelectEvent(ev: object) {
    const e = ev as CalEvent;
    setDetailBooking(e.booking);
  }

  async function handleCreateBooking(e: FormEvent) {
    e.preventDefault();
    if (!canCreate || !modalSpaceId || !userId) {
      setModalError("Choose a space and ensure you are signed in.");
      return;
    }
    setModalSaving(true);
    setModalError(null);
    const startIso = slotModal!.start.toISOString();
    const endIso = slotModal!.end.toISOString();
    if (new Date(endIso) <= new Date(startIso)) {
      setModalError("End time must be after start.");
      setModalSaving(false);
      return;
    }

    const supabase = getSupabaseClient();
    let insertPayload: Record<string, unknown>;

    const name = modalName.trim();
    const email = modalEmail.trim().toLowerCase();
    if (name && email) {
      insertPayload = {
        space_id: modalSpaceId,
        booker_type: "visitor",
        visitor_name: name,
        visitor_email: email,
        start_at: startIso,
        end_at: endIso,
        purpose: modalNotes.trim() || null,
        attendee_count: 1,
      };
    } else {
      insertPayload = {
        space_id: modalSpaceId,
        booker_type: "registered_user",
        booker_user_id: userId,
        start_at: startIso,
        end_at: endIso,
        purpose: modalNotes.trim() || null,
        attendee_count: 1,
      };
    }

    const { data, error: insErr } = await supabase
      .from("bookings")
      .insert(insertPayload as never)
      .select("id, status")
      .maybeSingle();

    if (insErr || !data) {
      setModalError(insErr?.message ?? "Could not create booking.");
      setModalSaving(false);
      return;
    }

    try {
      await fetch("/api/bookings/email", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: (data as { id: string }).id, kind: "created" }),
      });
    } catch {
      /* optional */
    }

    setSlotModal(null);
    setModalSaving(false);
    await loadBookings(propertyId, range);
  }

  async function handleCancelBooking(b: BookingRow) {
    if (!confirm("Cancel this booking?")) return;
    setDetailActing(true);
    const supabase = getSupabaseClient();
    const { error: uErr } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", b.id);
    setDetailActing(false);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    setDetailBooking(null);
    await loadBookings(propertyId, range);
  }

  function bookerDetailLabel(b: BookingRow): string {
    if (b.booker_type === "visitor") {
      return `${b.visitor_name ?? "—"}${b.visitor_email ? ` · ${b.visitor_email}` : ""}`;
    }
    if (b.booker_user_id) {
      const u = userMap[b.booker_user_id];
      return u ? `${u.display_name ?? u.email} · ${u.email}` : b.booker_user_id;
    }
    return "—";
  }

  if (!mounted) return <p>Loading…</p>;
  if (loading && properties.length === 0) return <p>Loading…</p>;

  return (
    <div className="vw-booking-cal">
      <h1 style={{ margin: "0 0 8px", fontFamily: "var(--font-instrument-serif), serif", fontWeight: 400 }}>
        Booking calendar
      </h1>
      <p style={{ marginTop: 0, color: "#555", fontSize: 14 }}>
        Week, day, and month views. Drag on the grid to create a booking. Click an event for details.
      </p>

      {error ? (
        <p style={{ color: "#b00020", marginTop: 12 }} role="alert">
          {error}
        </p>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "flex-end",
          marginTop: 16,
          marginBottom: 12,
        }}
      >
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#555", fontWeight: 500 }}>Property</span>
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(26,74,74,0.2)", minWidth: 220 }}
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
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "#555", fontWeight: 500 }}>Space type</span>
          <select
            value={spaceTypeFilter}
            onChange={(e) => setSpaceTypeFilter(e.target.value as SpaceTypeFilter)}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(26,74,74,0.2)", minWidth: 200 }}
          >
            <option value="all">All</option>
            <option value="meeting_room">Meeting rooms</option>
            <option value="hot_desk">Hot desks</option>
            <option value="office">Offices</option>
            <option value="venue">Venues</option>
          </select>
        </label>
        {!canCreate ? (
          <span style={{ fontSize: 13, color: "#7a5a00" }}>Your role cannot create bookings from the calendar.</span>
        ) : null}
      </div>

      <div className="vw-cal-rbc-wrap">
        <Calendar
          culture="en-GB"
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          style={{ height: view === Views.MONTH ? 720 : 960 }}
          view={view}
          views={[Views.DAY, Views.WEEK, Views.MONTH]}
          onView={(v) => setView(v)}
          date={date}
          onNavigate={setDate}
          resources={resources}
          min={MIN_TIME}
          max={MAX_TIME}
          step={30}
          timeslots={2}
          selectable={canCreate ? "ignoreEvents" : false}
          onSelectSlot={canCreate ? handleSelectSlot : undefined}
          onSelectEvent={handleSelectEvent}
          eventPropGetter={eventPropGetter}
          slotPropGetter={slotPropGetter}
          dayPropGetter={dayPropGetter}
          getNow={() => nowTick}
          formats={{
            timeGutterFormat: "HH:mm",
            eventTimeRangeFormat: ({ start, end }) =>
              `${format(start, "HH:mm")} – ${format(end, "HH:mm")}`,
            dayHeaderFormat: (d) => format(d, "EEE d MMM"),
            dayRangeHeaderFormat: ({ start, end }) =>
              `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`,
          }}
        />
      </div>

      <p style={{ marginTop: 16, fontSize: 14 }}>
        <Link href="/bookings/new">Advanced booking form</Link>
        {" · "}
        <Link href="/bookings/manage">Manage bookings</Link>
      </p>

      {slotModal ? (
        <div
          className="vw-cal-modal-backdrop"
          role="presentation"
          onClick={() => !modalSaving && setSlotModal(null)}
          onKeyDown={(k) => k.key === "Escape" && !modalSaving && setSlotModal(null)}
        >
          <div
            className="vw-cal-modal"
            role="dialog"
            aria-labelledby="vw-cal-new-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h2 id="vw-cal-new-title" style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 600 }}>
              New booking
            </h2>
            <p style={{ margin: "0 0 8px", color: "#555" }}>
              Date:{" "}
              <strong>{format(slotModal.start, "EEEE d MMM yyyy")}</strong>
            </p>
            <p style={{ margin: "0 0 16px", color: "#555" }}>
              Time:{" "}
              <strong>
                {format(slotModal.start, "HH:mm")} – {format(slotModal.end, "HH:mm")}
              </strong>
            </p>
            <form onSubmit={handleCreateBooking} style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Space</span>
                <select
                  value={modalSpaceId}
                  onChange={(e) => setModalSpaceId(e.target.value)}
                  required
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                >
                  {bookableSpacesForModal.length === 0 ? (
                    <option value="">No bookable spaces (check type filter / availability)</option>
                  ) : null}
                  {bookableSpacesForModal.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {spaceTypeLabel(s.space_type)} · {Number(s.hourly_price)}/hr
                      {s.requires_approval ? " · needs approval" : ""}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: 12, color: "#777" }}>Filtered by property and space type. Offices use leases, not hourly booking.</span>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Booked for (name / company)</span>
                <input
                  value={modalName}
                  onChange={(e) => setModalName(e.target.value)}
                  placeholder="Leave empty to book for yourself"
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Email</span>
                <input
                  type="email"
                  value={modalEmail}
                  onChange={(e) => setModalEmail(e.target.value)}
                  placeholder="Required if booking for a visitor"
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Notes</span>
                <input
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
                />
              </label>
              {modalError ? <p style={{ color: "#b00020", margin: 0 }}>{modalError}</p> : null}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button
                  type="button"
                  className="vw-btn-cal-ghost"
                  disabled={modalSaving}
                  onClick={() => setSlotModal(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="vw-btn-cal-primary" disabled={modalSaving || !modalSpaceId}>
                  {modalSaving ? "Creating…" : "Create booking"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {detailBooking ? (
        <div
          className="vw-cal-modal-backdrop"
          role="presentation"
          onClick={() => !detailActing && setDetailBooking(null)}
        >
          <div className="vw-cal-modal" role="dialog" onClick={(ev) => ev.stopPropagation()}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 600 }}>Booking details</h2>
            <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
              <div>
                <strong>Space</strong>
                <div>
                  {detailBooking.bookable_spaces?.name ?? "—"} (
                  {spaceTypeLabel(detailBooking.bookable_spaces?.space_type ?? "")})
                </div>
              </div>
              <div>
                <strong>Booked by</strong>
                <div>{bookerDetailLabel(detailBooking)}</div>
                {detailBooking.tenants?.name ? (
                  <div style={{ color: "#555" }}>Tenant: {detailBooking.tenants.name}</div>
                ) : null}
              </div>
              <div>
                <strong>When</strong>
                <div>
                  {format(new Date(detailBooking.start_at), "EEE d MMM yyyy HH:mm")} –{" "}
                  {format(new Date(detailBooking.end_at), "HH:mm")} (
                  {differenceInMinutes(new Date(detailBooking.end_at), new Date(detailBooking.start_at))} min)
                </div>
              </div>
              {detailBooking.purpose ? (
                <div>
                  <strong>Notes</strong>
                  <div>{detailBooking.purpose}</div>
                </div>
              ) : null}
              <div>
                <strong>Status</strong>
                <div style={{ textTransform: "capitalize" }}>{detailBooking.status}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
              <Link href="/bookings/manage" className="vw-btn-cal-ghost" style={{ textDecoration: "none" }}>
                Edit / manage
              </Link>
              <button
                type="button"
                className="vw-btn-cal-danger"
                disabled={detailActing || ["cancelled", "rejected"].includes(detailBooking.status)}
                onClick={() => void handleCancelBooking(detailBooking)}
              >
                {detailActing ? "…" : "Cancel booking"}
              </button>
              <button type="button" className="vw-btn-cal-ghost" onClick={() => setDetailBooking(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        .vw-booking-cal {
          font-family: var(--font-dm-sans), sans-serif;
          color: var(--petrol, #1a4a4a);
        }
        .vw-cal-rbc-wrap {
          background: #fff;
          border-radius: 12px;
          border: 1px solid rgba(26, 74, 74, 0.12);
          overflow: hidden;
          box-shadow: 0 4px 22px rgba(26, 74, 74, 0.06);
        }
        .vw-cal-rbc-wrap .rbc-calendar {
          font-family: var(--font-dm-sans), sans-serif;
        }
        .vw-cal-rbc-wrap .rbc-header {
          background: #1a4a4a !important;
          color: #fff !important;
          font-weight: 500;
          font-size: 13px;
          padding: 10px 6px !important;
          border: none !important;
        }
        .vw-cal-rbc-wrap .rbc-today.rbc-header,
        .vw-cal-rbc-wrap .rbc-header.vw-cal-today-cell {
          background: #3aafa9 !important;
          color: #fff !important;
        }
        .vw-cal-rbc-wrap .rbc-time-header-content .rbc-header.rbc-today {
          background: #3aafa9 !important;
        }
        .vw-cal-rbc-wrap .rbc-time-content {
          border-top: 1px solid #e8e8e8;
        }
        .vw-cal-rbc-wrap .rbc-time-slot {
          min-height: 30px;
        }
        .vw-cal-rbc-wrap .rbc-timeslot-group {
          min-height: 60px;
        }
        .vw-cal-rbc-wrap .rbc-time-gutter .rbc-timeslot-group {
          font-size: 12px;
          color: #555;
        }
        .vw-cal-rbc-wrap .rbc-day-slot .rbc-time-slot {
          border-top: 1px solid #eee;
        }
        .vw-cal-rbc-wrap .rbc-day-bg + .rbc-day-bg {
          border-left: 1px solid #e8e8e8;
        }
        .vw-cal-rbc-wrap .rbc-time-column .rbc-timeslot-group {
          border-bottom: 1px solid #e8e8e8;
        }
        .vw-cal-rbc-wrap .rbc-off-range-bg {
          background: #f7f7f7;
        }
        .vw-cal-rbc-wrap .vw-cal-slot-offhours {
          background: #faf6ef !important;
        }
        .vw-cal-rbc-wrap .rbc-today {
          background: rgba(58, 175, 169, 0.06);
        }
        .vw-cal-rbc-wrap .rbc-current-time-indicator {
          background-color: #e53935 !important;
          height: 2px !important;
        }
        .vw-cal-rbc-wrap .rbc-event {
          padding: 4px 6px !important;
        }
        .vw-cal-rbc-wrap .rbc-event:focus {
          outline: 2px solid #1a4a4a;
          outline-offset: 1px;
        }
        .vw-cal-rbc-wrap .rbc-toolbar {
          padding: 12px 16px;
          flex-wrap: wrap;
          gap: 8px;
          background: #fafafa;
          border-bottom: 1px solid #e8e8e8;
        }
        .vw-cal-rbc-wrap .rbc-toolbar button {
          color: #1a4a4a;
          border: 1px solid rgba(26, 74, 74, 0.25);
          border-radius: 8px;
          padding: 6px 12px;
          font-size: 13px;
          background: #fff;
          cursor: pointer;
        }
        .vw-cal-rbc-wrap .rbc-toolbar button:hover {
          background: rgba(58, 175, 169, 0.12);
          border-color: #3aafa9;
        }
        .vw-cal-rbc-wrap .rbc-toolbar button.rbc-active {
          background: #1a4a4a;
          color: #fff;
          border-color: #1a4a4a;
        }
        .vw-cal-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }
        .vw-cal-modal {
          background: #fff;
          border-radius: 14px;
          padding: 24px;
          max-width: 440px;
          width: 100%;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
        }
        .vw-btn-cal-primary {
          padding: 10px 18px;
          border-radius: 10px;
          border: none;
          background: #1a4a4a;
          color: #fff;
          font-weight: 500;
          cursor: pointer;
        }
        .vw-btn-cal-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .vw-btn-cal-ghost {
          padding: 10px 18px;
          border-radius: 10px;
          border: 1px solid rgba(26, 74, 74, 0.3);
          background: #fff;
          color: #1a4a4a;
          font-weight: 500;
          cursor: pointer;
        }
        .vw-btn-cal-danger {
          padding: 10px 18px;
          border-radius: 10px;
          border: 1px solid #c62828;
          background: #fff;
          color: #c62828;
          font-weight: 500;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
