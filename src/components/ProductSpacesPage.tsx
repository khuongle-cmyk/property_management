"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { createRoomPhotoSignedUrlMap } from "@/lib/storage/room-photo-signed-url";
import { spaceTypeLabel } from "@/lib/rooms/labels";

type ProductType = "office" | "conference_room" | "venue" | "hot_desk" | "meeting_room";

type SpaceRow = {
  id: string;
  property_id: string;
  name: string;
  floor: string | null;
  size_m2: number | null;
  capacity: number | null;
  space_type: string;
  space_status: string | null;
  hourly_price: number | null;
  half_day_price_eur: number | null;
  full_day_price_eur: number | null;
  daily_price_eur: number | null;
  min_booking_hours: number | null;
  requires_approval: boolean | null;
  amenity_projector: boolean | null;
  amenity_video_conferencing: boolean | null;
  amenity_whiteboard: boolean | null;
  amenity_kitchen_access: boolean | null;
  amenity_reception_service: boolean | null;
  monthly_rent_eur: number | null;
};

type PropertyRow = { id: string; name: string | null; city: string | null };
type PhotoRow = { space_id: string; storage_path: string; sort_order: number | null };
type BookingRow = {
  id: string;
  space_id: string;
  property_id: string;
  start_at: string;
  end_at: string;
  status: string | null;
  total_price: number | null;
};

function monthBounds() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

function overlapHours(startA: Date, endA: Date, startB: Date, endB: Date): number {
  const s = Math.max(startA.getTime(), startB.getTime());
  const e = Math.min(endA.getTime(), endB.getTime());
  return Math.max(0, (e - s) / 36e5);
}

export default function ProductSpacesPage({
  title,
  productType,
  spaceTypes,
  publicPath,
}: {
  title: string;
  /** Single type filter (use with `spaceTypes` unset). */
  productType?: ProductType;
  /** Multiple DB `space_type` values (e.g. meeting_room + conference_room). */
  spaceTypes?: string[];
  publicPath: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [properties, setProperties] = useState<Map<string, PropertyRow>>(new Map());
  const [photos, setPhotos] = useState<Map<string, string[]>>(new Map());
  const [bookings, setBookings] = useState<BookingRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const supabase = getSupabaseClient();

      const types =
        spaceTypes && spaceTypes.length > 0 ? spaceTypes : productType ? [productType] : [];
      if (types.length === 0) {
        if (!cancelled) setError("Configure productType or spaceTypes.");
        if (!cancelled) setLoading(false);
        return;
      }

      let spaceQuery = supabase
        .from("bookable_spaces")
        .select(
          "id,property_id,name,floor,size_m2,capacity,space_type,space_status,hourly_price,half_day_price_eur,full_day_price_eur,daily_price_eur,min_booking_hours,requires_approval,amenity_projector,amenity_video_conferencing,amenity_whiteboard,amenity_kitchen_access,amenity_reception_service,monthly_rent_eur",
        )
        .order("name", { ascending: true });
      spaceQuery = types.length === 1 ? spaceQuery.eq("space_type", types[0]!) : spaceQuery.in("space_type", types);

      const { data: spacesData, error: sErr } = await spaceQuery;
      if (sErr) {
        if (!cancelled) setError(sErr.message);
        if (!cancelled) setLoading(false);
        return;
      }
      const list = (spacesData ?? []) as SpaceRow[];
      const propertyIds = [...new Set(list.map((s) => s.property_id))];
      const spaceIds = list.map((s) => s.id);

      const [{ data: pData }, { data: phData }, { data: bData }] = await Promise.all([
        propertyIds.length
          ? supabase.from("properties").select("id,name,city").in("id", propertyIds)
          : Promise.resolve({ data: [] as PropertyRow[] }),
        spaceIds.length
          ? supabase
              .from("room_photos")
              .select("space_id,storage_path,sort_order")
              .in("space_id", spaceIds)
              .order("sort_order", { ascending: true })
          : Promise.resolve({ data: [] as PhotoRow[] }),
        spaceIds.length
          ? supabase
              .from("bookings")
              .select("id,space_id,property_id,start_at,end_at,status,total_price")
              .in("space_id", spaceIds)
              .gte("end_at", monthBounds().start)
              .lt("start_at", monthBounds().end)
          : Promise.resolve({ data: [] as BookingRow[] }),
      ]);

      if (cancelled) return;

      const pMap = new Map<string, PropertyRow>();
      for (const p of ((pData ?? []) as PropertyRow[])) pMap.set(p.id, p);
      setProperties(pMap);

      const photoRows = (phData ?? []) as PhotoRow[];
      const signedByPath = await createRoomPhotoSignedUrlMap(
        supabase,
        photoRows.map((r) => r.storage_path),
      );
      const phMap = new Map<string, string[]>();
      for (const ph of photoRows) {
        const url = signedByPath.get(ph.storage_path);
        if (!url) continue;
        const curr = phMap.get(ph.space_id) ?? [];
        curr.push(url);
        phMap.set(ph.space_id, curr);
      }
      setPhotos(phMap);
      setBookings((bData ?? []) as BookingRow[]);
      setSpaces(list);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [productType, spaceTypes]);

  const metrics = useMemo(() => {
    const { start, end } = monthBounds();
    const ms = new Date(start);
    const me = new Date(end);
    const map = new Map<string, { revenue: number; utilizationPct: number }>();
    for (const s of spaces) {
      const rows = bookings.filter((b) => b.space_id === s.id && (b.status ?? "") !== "cancelled");
      const revenue =
        s.space_type === "office"
          ? (s.space_status === "occupied" ? Number(s.monthly_rent_eur ?? 0) : 0)
          : rows.reduce((sum, b) => sum + Number(b.total_price ?? 0), 0);
      const bookedHours = rows.reduce((sum, b) => {
        const bs = new Date(b.start_at);
        const be = new Date(b.end_at);
        return sum + overlapHours(bs, be, ms, me);
      }, 0);
      const days = Math.max(1, Math.round((me.getTime() - ms.getTime()) / 86400000));
      const monthlyAvailableHours = days * 8;
      const utilizationPct = monthlyAvailableHours > 0 ? Math.round((bookedHours / monthlyAvailableHours) * 1000) / 10 : 0;
      map.set(s.id, { revenue, utilizationPct });
    }
    return map;
  }, [bookings, spaces]);

  if (loading) return <p>Loading {title.toLowerCase()}...</p>;
  if (error) return <p style={{ color: "#b00020" }}>Failed to load {title.toLowerCase()}: {error}</p>;

  return (
    <main style={{ display: "grid", gap: 14 }}>
      <div>
        <h1 className="vw-admin-page-title" style={{ margin: 0 }}>{title}</h1>
        <p style={{ marginTop: 6, color: "#556" }}>
          Dedicated {title.toLowerCase()} section with pricing, availability, monthly revenue, utilization, and quick actions.
        </p>
      </div>

      {spaces.length === 0 ? <p>No {title.toLowerCase()} found.</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 12 }}>
        {spaces.map((s) => {
          const p = properties.get(s.property_id);
          const m = metrics.get(s.id) ?? { revenue: 0, utilizationPct: 0 };
          const pics = photos.get(s.id) ?? [];
          const amenityList = [
            s.amenity_projector ? "Projector" : null,
            s.amenity_video_conferencing ? "Video conf" : null,
            s.amenity_whiteboard ? "Whiteboard" : null,
            s.amenity_kitchen_access ? "Kitchen" : null,
            s.amenity_reception_service ? "Reception" : null,
          ].filter(Boolean) as string[];
          const bookingMode = s.requires_approval ? "Inquiry-based" : "Instant booking";

          return (
            <article key={s.id} style={{ border: "1px solid #dce8e8", borderRadius: 12, padding: 12, background: "#fff", display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>{s.name}</strong>
                <span style={{ fontSize: 12, color: "#445" }}>{spaceTypeLabel(s.space_type)}</span>
              </div>
              <div style={{ fontSize: 13, color: "#555" }}>
                {(p?.name ?? "Property")} {p?.city ? `· ${p.city}` : ""}
              </div>
              <div style={{ fontSize: 13 }}>
                Capacity {s.capacity ?? "—"} · Floor {s.floor ?? "—"} · {s.size_m2 ?? "—"} m2
              </div>
              <div style={{ fontSize: 13 }}>
                Status: <strong>{(s.space_status ?? "unknown").replace(/_/g, " ")}</strong> · Utilization: <strong>{m.utilizationPct}%</strong>
              </div>
              <div style={{ fontSize: 13 }}>
                Revenue this month: <strong>EUR {m.revenue.toFixed(2)}</strong>
              </div>
              <div style={{ fontSize: 13 }}>
                Pricing: {s.hourly_price != null ? `EUR ${s.hourly_price}/h` : "—"}
                {s.half_day_price_eur != null ? ` · Half-day EUR ${s.half_day_price_eur}` : ""}
                {s.full_day_price_eur != null ? ` · Full-day EUR ${s.full_day_price_eur}` : ""}
                {s.daily_price_eur != null ? ` · Daily EUR ${s.daily_price_eur}` : ""}
                {s.min_booking_hours != null ? ` · Min ${s.min_booking_hours}h` : ""}
              </div>
              {s.space_type === "venue" ? (
                <div style={{ fontSize: 13 }}>
                  Event types: Corporate events, workshops, networking · Booking mode: <strong>{bookingMode}</strong> · Catering: {s.amenity_kitchen_access ? "Yes" : "No"} · AV included: {s.amenity_video_conferencing || s.amenity_projector ? "Yes" : "No"} · Evening/weekend: custom quote
                </div>
              ) : null}
              <div style={{ fontSize: 13 }}>Amenities: {amenityList.length ? amenityList.join(", ") : "Not specified"}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {pics.slice(0, 3).map((url, i) => (
                  <img key={`${s.id}-${i}`} src={url} alt="" style={{ width: 74, height: 52, borderRadius: 6, objectFit: "cover", border: "1px solid #e8f0f0" }} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link href={`/bookings/new?propertyId=${encodeURIComponent(s.property_id)}`} style={{ textDecoration: "none", border: "1px solid #1a5c5a", color: "#1a5c5a", borderRadius: 8, padding: "6px 10px" }}>
                  Quick book
                </Link>
                <Link href={`/bookings/calendar?propertyId=${encodeURIComponent(s.property_id)}&spaceId=${encodeURIComponent(s.id)}`} style={{ textDecoration: "none", border: "1px solid #d5e5e5", color: "#243", borderRadius: 8, padding: "6px 10px" }}>
                  Booking calendar
                </Link>
                <Link href={publicPath} style={{ textDecoration: "none", border: "1px solid #d5e5e5", color: "#243", borderRadius: 8, padding: "6px 10px" }}>
                  Public listing
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}

