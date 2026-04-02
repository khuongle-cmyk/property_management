"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ROOM_TYPE_COLORS, type FloorPlanRoomType, type OccupancyKind } from "@/lib/floor-plans/constants";

const OCC_STYLES: Record<OccupancyKind, { fill: string; stroke: string; label: string }> = {
  available: { fill: "#bbf7d0", stroke: "#166534", label: "Available" },
  occupied: { fill: "#fecaca", stroke: "#991b1b", label: "Occupied" },
  reserved: { fill: "#fef08a", stroke: "#a16207", label: "Reserved" },
  not_rentable: { fill: "#e5e7eb", stroke: "#4b5563", label: "Not rentable" },
  unlinked: { fill: "#f3f4f6", stroke: "#9ca3af", label: "Unlinked" },
};

type RoomOcc = {
  id: string;
  room_number: string;
  room_name: string;
  room_type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  shape: string;
  polygon_points: unknown;
  is_rentable: boolean;
  occupancy: OccupancyKind;
  display_size_m2: number | null;
  display_capacity: number | null;
  display_rent: number | null;
  contract: { tenant_name: string | null; end_date: string | null; monthly_rent: number } | null;
};

function hitTestRoom(wx: number, wy: number, rooms: RoomOcc[]): string | null {
  for (let i = rooms.length - 1; i >= 0; i--) {
    const r = rooms[i];
    if (r.shape === "polygon" && Array.isArray(r.polygon_points) && (r.polygon_points as number[]).length >= 6) {
      const pts = r.polygon_points as number[];
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (let k = 0; k < pts.length; k += 2) {
        const px = r.x + pts[k];
        const py = r.y + pts[k + 1];
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
      if (wx >= minX && wx <= maxX && wy >= minY && wy <= maxY) return r.id;
    } else {
      if (wx >= r.x && wx <= r.x + r.width && wy >= r.y && wy <= r.y + r.height) return r.id;
    }
  }
  return null;
}

export default function FloorPlanViewerInner() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [viewport, setViewport] = useState({ w: 920, h: 560 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const [data, setData] = useState<{
    plan: { name: string; width_meters: number; height_meters: number; scale: number; status?: string };
    rooms: RoomOcc[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<RoomOcc | null>(null);
  const [panel, setPanel] = useState<RoomOcc | null>(null);
  const [filterOcc, setFilterOcc] = useState<"all" | "available" | "occupied">("all");
  const [filterType, setFilterType] = useState<"all" | "office" | "meeting" | "desk">("all");

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    const res = await fetch(`/api/floor-plans/${encodeURIComponent(id)}/occupancy`);
    const json = (await res.json()) as { plan?: Record<string, unknown>; rooms?: RoomOcc[]; error?: string };
    if (!res.ok) {
      setError(json.error ?? "Failed to load");
      setLoading(false);
      return;
    }
    if (!json.plan) {
      setError("Not found");
      setLoading(false);
      return;
    }
    const scale = Number(json.plan.scale) || 100;
    setData({
      plan: {
        name: String(json.plan.name ?? ""),
        width_meters: Number(json.plan.width_meters) || 20,
        height_meters: Number(json.plan.height_meters) || 15,
        scale,
        status: String(json.plan.status ?? ""),
      },
      rooms: json.rooms ?? [],
    });
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onResize = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setViewport({ w: Math.max(280, Math.min(1100, r.width)), h: Math.max(320, Math.min(720, window.innerHeight - 200)) });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const fpW = data ? data.plan.width_meters * data.plan.scale : 800;
  const fpH = data ? data.plan.height_meters * data.plan.scale : 600;

  const visibleRooms = useMemo(() => {
    if (!data) return [];
    return data.rooms.filter((r) => {
      if (filterOcc === "available" && r.occupancy !== "available" && r.occupancy !== "unlinked") return false;
      if (filterOcc === "occupied" && r.occupancy !== "occupied") return false;
      if (filterType === "office" && r.room_type !== "office") return false;
      if (filterType === "meeting" && r.room_type !== "meeting_room") return false;
      if (filterType === "desk" && r.room_type !== "hot_desk") return false;
      return true;
    });
  }, [data, filterOcc, filterType]);

  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const sx = ((clientX - rect.left) * canvas.width) / rect.width;
      const sy = ((clientY - rect.top) * canvas.height) / rect.height;
      return { x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom };
    },
    [pan.x, pan.y, zoom],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const vw = viewport.w;
    const vh = viewport.h;
    canvas.width = Math.floor(vw * dpr);
    canvas.height = Math.floor(vh * dpr);
    canvas.style.width = `${vw}px`;
    canvas.style.height = `${vh}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#f9fafb";
    ctx.fillRect(0, 0, vw, vh);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2 / zoom;
    ctx.fillRect(0, 0, fpW, fpH);
    ctx.strokeRect(0, 0, fpW, fpH);

    for (const room of visibleRooms) {
      const occ = OCC_STYLES[room.occupancy] ?? OCC_STYLES.unlinked;
      const rt = room.room_type in ROOM_TYPE_COLORS ? (room.room_type as FloorPlanRoomType) : "other";
      const base = ROOM_TYPE_COLORS[rt];
      const fill = room.occupancy === "not_rentable" ? occ.fill : base.fill;
      const stroke = occ.stroke;
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2 / zoom;
      ctx.globalAlpha = 0.95;

      if (room.shape === "polygon" && Array.isArray(room.polygon_points) && (room.polygon_points as number[]).length >= 6) {
        const pts = room.polygon_points as number[];
        ctx.beginPath();
        ctx.moveTo(room.x + pts[0], room.y + pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(room.x + pts[i], room.y + pts[i + 1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(room.x, room.y, room.width, room.height);
        ctx.strokeRect(room.x, room.y, room.width, room.height);
      }

      const label = [room.room_number, room.room_name].filter(Boolean).join(" · ") || "Room";
      ctx.fillStyle = "#111827";
      ctx.globalAlpha = 1;
      ctx.font = `${12 / zoom}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, room.x + room.width / 2, room.y + room.height / 2);
    }

    ctx.restore();
  }, [data, visibleRooms, pan, zoom, fpW, fpH, viewport.w, viewport.h]);

  useEffect(() => {
    draw();
  }, [draw]);

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!data) return;
    const w = clientToWorld(e.clientX, e.clientY);
    const hit = hitTestRoom(w.x, w.y, visibleRooms);
    setHover(hit ? data.rooms.find((r) => r.id === hit) ?? null : null);
  };

  const onPointerLeave = () => setHover(null);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data) return;
    const w = clientToWorld(e.clientX, e.clientY);
    const hit = hitTestRoom(w.x, w.y, visibleRooms);
    setPanel(hit ? data.rooms.find((r) => r.id === hit) ?? null : null);
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) * canvas.width) / rect.width;
    const py = ((e.clientY - rect.top) * canvas.height) / rect.height;
    const old = zoom;
    const delta = e.deltaY > 0 ? -0.06 : 0.06;
    const next = Math.min(3, Math.max(0.15, old + delta));
    const wx = (px - pan.x) / old;
    const wy = (py - pan.y) / old;
    setPan({ x: px - wx * next, y: py - wy * next });
    setZoom(next);
  };

  if (!id) return <main style={{ padding: 24 }}>Invalid plan.</main>;
  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (error || !data) return <p style={{ padding: 24, color: "#b00020" }}>{error ?? "Not found"}</p>;

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "16px" }}>
      <div style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <Link href="/floor-plans">← Floor planner</Link>
        <Link href={`/floor-plans/${id}/edit`}>Edit</Link>
        <h1 className="vw-admin-page-title" style={{ margin: 0, flex: "1 1 auto" }}>{data.plan.name}</h1>
        {data.plan.status === "draft" ? (
          <span style={{ fontSize: 13, color: "#92400e", background: "#fef3c7", padding: "4px 10px", borderRadius: 8 }}>Draft</span>
        ) : null}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 200 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Status</div>
            <select value={filterOcc} onChange={(e) => setFilterOcc(e.target.value as typeof filterOcc)} style={{ width: "100%", padding: 8 }}>
              <option value="all">All</option>
              <option value="available">Available</option>
              <option value="occupied">Occupied</option>
            </select>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Type</div>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value as typeof filterType)} style={{ width: "100%", padding: 8 }}>
              <option value="all">All</option>
              <option value="office">Offices</option>
              <option value="meeting">Meeting</option>
              <option value="desk">Hot desks</option>
            </select>
          </div>
          <div style={{ fontSize: 13, color: "#444" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Legend</div>
            {(Object.keys(OCC_STYLES) as OccupancyKind[]).map((k) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ width: 12, height: 12, borderRadius: 2, background: OCC_STYLES[k].fill, border: `1px solid ${OCC_STYLES[k].stroke}` }} />
                {OCC_STYLES[k].label}
              </div>
            ))}
          </div>
        </div>

        <div ref={wrapRef} style={{ flex: "1 1 480px", minWidth: 280, border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", background: "#f9fafb" }}>
          <canvas
            ref={canvasRef}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            onClick={onClick}
            onWheel={onWheel}
            style={{ display: "block", cursor: "default", touchAction: "none" }}
          />
        </div>

        <aside style={{ width: 280, minWidth: 240, border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, fontSize: 14 }}>
          {panel ? (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{panel.room_name || panel.room_number || "Room"}</div>
              <p style={{ margin: "4px 0", color: "#555" }}>
                #{panel.room_number} · {panel.room_type.replace("_", " ")}
              </p>
              <p style={{ margin: "4px 0" }}>Status: {OCC_STYLES[panel.occupancy]?.label ?? panel.occupancy}</p>
              {panel.display_size_m2 != null ? <p style={{ margin: "4px 0" }}>Size: {Number(panel.display_size_m2).toFixed(1)} m²</p> : null}
              {panel.display_capacity != null ? <p style={{ margin: "4px 0" }}>Capacity: {panel.display_capacity}</p> : null}
              {panel.display_rent != null ? <p style={{ margin: "4px 0" }}>Rent: €{Number(panel.display_rent).toFixed(0)} / mo</p> : null}
              {panel.contract?.tenant_name ? <p style={{ margin: "4px 0" }}>Tenant: {panel.contract.tenant_name}</p> : null}
              {panel.contract?.end_date ? <p style={{ margin: "4px 0" }}>Contract end: {panel.contract.end_date}</p> : null}
              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                <Link
                  href={panel.room_type === "meeting_room" ? `/bookings/new?spaceHint=${encodeURIComponent(panel.id)}` : `/crm`}
                  style={{ padding: "8px 12px", background: "#1a4a4a", color: "#fff", borderRadius: 8, textAlign: "center", textDecoration: "none" }}
                >
                  {panel.room_type === "meeting_room" ? "Book now" : "Create contract"}
                </Link>
              </div>
            </div>
          ) : (
            <p style={{ color: "#6b7280" }}>Click a room for details.</p>
          )}
        </aside>
      </div>

      {hover ? (
        <div
          style={{
            position: "fixed",
            pointerEvents: "none",
            left: 24,
            bottom: 24,
            background: "rgba(17,24,39,0.92)",
            color: "#fff",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            maxWidth: 320,
            zIndex: 40,
          }}
        >
          <div style={{ fontWeight: 600 }}>{[hover.room_number, hover.room_name].filter(Boolean).join(" · ")}</div>
          {hover.contract?.tenant_name ? <div>Tenant: {hover.contract.tenant_name}</div> : null}
          {hover.contract?.end_date ? <div>Ends: {hover.contract.end_date}</div> : null}
          {hover.display_size_m2 != null ? <div>{Number(hover.display_size_m2).toFixed(1)} m²</div> : null}
          {hover.display_capacity != null ? <div>Cap. {hover.display_capacity}</div> : null}
          {hover.display_rent != null ? <div>€{Number(hover.display_rent).toFixed(0)} / mo</div> : null}
        </div>
      ) : null}
    </main>
  );
}
