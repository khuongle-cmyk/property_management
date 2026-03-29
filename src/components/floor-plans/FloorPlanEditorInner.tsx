"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultMetadata,
  FLOOR_PLAN_ROOM_TYPES,
  ROOM_TYPE_COLORS,
  ROOM_TYPE_LABELS,
  type FloorPlanRoomType,
} from "@/lib/floor-plans/constants";

type PlanRow = {
  id: string;
  tenant_id: string;
  property_id: string;
  name: string;
  floor_number: number;
  width_meters: number;
  height_meters: number;
  scale: number;
  background_image_url: string | null;
  background_opacity: number;
  show_background: boolean;
  status: string;
  canvas_data: Record<string, unknown>;
};

type RoomRow = {
  id: string;
  room_number: string;
  room_name: string;
  room_type: string;
  bookable_space_id: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string | null;
  shape: string;
  polygon_points: unknown;
  label_x: number | null;
  label_y: number | null;
  is_rentable: boolean;
  metadata: Record<string, unknown>;
};

type ElementRow = {
  id: string;
  element_type: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number;
  points: number[] | null;
  style: Record<string, unknown>;
  label: string | null;
};

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function nextRoomNumber(rooms: RoomRow[]): string {
  let max = 100;
  for (const r of rooms) {
    const m = parseInt(String(r.room_number).replace(/\D/g, ""), 10);
    if (Number.isFinite(m) && m >= max) max = m + 1;
  }
  return String(max);
}

function hitTestRoom(wx: number, wy: number, rooms: RoomRow[]): string | null {
  for (let i = rooms.length - 1; i >= 0; i--) {
    const r = rooms[i];
    if (r.shape === "polygon" && Array.isArray(r.polygon_points) && (r.polygon_points as number[]).length >= 6) {
      const pts = r.polygon_points as number[];
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (let k = 0; k < pts.length; k += 2) {
        minX = Math.min(minX, pts[k]);
        maxX = Math.max(maxX, pts[k]);
        minY = Math.min(minY, pts[k + 1]);
        maxY = Math.max(maxY, pts[k + 1]);
      }
      if (wx >= minX && wx <= maxX && wy >= minY && wy <= maxY) return r.id;
    } else {
      if (wx >= r.x && wx <= r.x + r.width && wy >= r.y && wy <= r.y + r.height) return r.id;
    }
  }
  return null;
}

export default function FloorPlanEditorInner({ floorPlanId }: { floorPlanId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [viewport, setViewport] = useState({ w: 920, h: 560 });
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [elements, setElements] = useState<ElementRow[]>([]);
  const [tool, setTool] = useState<"select" | "rect">("select");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 24, y: 24 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [dirty, setDirty] = useState(false);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);

  const [draftRect, setDraftRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<{ roomId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const roomsRef = useRef(rooms);
  const elementsRef = useRef(elements);
  const planRef = useRef(plan);
  useEffect(() => {
    roomsRef.current = rooms;
    elementsRef.current = elements;
    planRef.current = plan;
  }, [rooms, elements, plan]);

  const ppm = plan ? num(plan.scale, 100) : 100;
  const fpW = plan ? num(plan.width_meters, 20) * ppm : 800;
  const fpH = plan ? num(plan.height_meters, 15) * ppm : 600;
  const gridPx = 0.5 * ppm;

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/floor-plans/${encodeURIComponent(floorPlanId)}`);
    const json = (await res.json()) as { plan?: PlanRow; rooms?: RoomRow[]; elements?: ElementRow[]; error?: string };
    if (!res.ok) {
      setError(json.error ?? "Load failed");
      setLoading(false);
      return;
    }
    const p = json.plan;
    if (!p) {
      setError("Not found");
      setLoading(false);
      return;
    }
    setPlan({
      ...p,
      width_meters: num(p.width_meters, 20),
      height_meters: num(p.height_meters, 15),
      scale: num(p.scale, 100),
      background_opacity: num(p.background_opacity, 0.5),
      show_background: p.show_background !== false,
    });
    setRooms(
      (json.rooms ?? []).map((r) => ({
        ...r,
        x: num(r.x),
        y: num(r.y),
        width: num(r.width, 40),
        height: num(r.height, 40),
        rotation: num(r.rotation),
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
      })),
    );
    setElements(
      (json.elements ?? []).map((el) => ({
        ...el,
        x: num(el.x),
        y: num(el.y),
        width: el.width != null ? num(el.width) : null,
        height: el.height != null ? num(el.height) : null,
        rotation: num(el.rotation),
        points: el.points as number[] | null,
        style: (el.style ?? {}) as Record<string, unknown>,
      })),
    );
    setLoading(false);
  }, [floorPlanId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onResize = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setViewport({ w: Math.max(320, Math.min(1100, r.width)), h: Math.max(360, Math.min(720, window.innerHeight - 220)) });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!plan?.background_image_url || !plan.show_background) {
      setBgImage(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setBgImage(img);
    img.onerror = () => setBgImage(null);
    img.src = plan.background_image_url;
  }, [plan?.background_image_url, plan?.show_background]);

  const save = useCallback(async (showDone = true) => {
    const p = planRef.current;
    const rs = roomsRef.current;
    const els = elementsRef.current;
    if (!p) return;
    setSaveState("saving");
    const body = {
      name: p.name,
      floor_number: p.floor_number,
      width_meters: p.width_meters,
      height_meters: p.height_meters,
      scale: p.scale,
      background_image_url: p.background_image_url,
      background_opacity: p.background_opacity,
      show_background: p.show_background,
      status: p.status,
      canvas_data: p.canvas_data ?? {},
      rooms: rs.map((r) => ({
        id: r.id,
        bookable_space_id: r.bookable_space_id,
        room_number: r.room_number,
        room_name: r.room_name,
        room_type: r.room_type,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        rotation: r.rotation,
        color: r.color,
        shape: r.shape,
        polygon_points: r.polygon_points,
        label_x: r.label_x,
        label_y: r.label_y,
        is_rentable: r.is_rentable,
        metadata: r.metadata,
      })),
      elements: els.map((el) => ({
        id: el.id,
        element_type: el.element_type,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        rotation: el.rotation,
        points: el.points,
        style: el.style,
        label: el.label,
      })),
    };
    const res = await fetch(`/api/floor-plans/${encodeURIComponent(floorPlanId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Save failed");
      setSaveState("idle");
      return;
    }
    setDirty(false);
    if (showDone) setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 1600);
  }, [floorPlanId]);

  useEffect(() => {
    if (!dirty) return;
    const t = setInterval(() => void save(false), 30000);
    return () => clearInterval(t);
  }, [dirty, save]);

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
    if (!canvas || !plan) return;
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
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, vw, vh);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2 / zoom;
    ctx.fillRect(0, 0, fpW, fpH);
    ctx.strokeRect(0, 0, fpW, fpH);

    if (bgImage && plan.show_background) {
      ctx.globalAlpha = num(plan.background_opacity, 0.5);
      ctx.drawImage(bgImage, 0, 0, fpW, fpH);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1 / zoom;
    for (let x = 0; x <= fpW; x += gridPx) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, fpH);
      ctx.stroke();
    }
    for (let y = 0; y <= fpH; y += gridPx) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(fpW, y);
      ctx.stroke();
    }

    for (const r of rooms) {
      const rt = (FLOOR_PLAN_ROOM_TYPES as readonly string[]).includes(r.room_type)
        ? (r.room_type as FloorPlanRoomType)
        : "other";
      const { fill, stroke } = ROOM_TYPE_COLORS[rt];
      ctx.fillStyle = r.color ?? fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2 / zoom;
      if (r.shape === "polygon" && Array.isArray(r.polygon_points) && (r.polygon_points as number[]).length >= 6) {
        const pts = r.polygon_points as number[];
        ctx.beginPath();
        ctx.moveTo(r.x + pts[0], r.y + pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(r.x + pts[i], r.y + pts[i + 1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(r.x, r.y, r.width, r.height);
        ctx.strokeRect(r.x, r.y, r.width, r.height);
      }
      if (selectedId === r.id) {
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 3 / zoom;
        ctx.strokeRect(r.x - 1, r.y - 1, r.width + 2, r.height + 2);
      }
      const label = [r.room_number, r.room_name].filter(Boolean).join(" · ") || "Room";
      ctx.fillStyle = "#111827";
      ctx.font = `${12 / zoom}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lx = r.x + r.width / 2;
      const ly = r.y + r.height / 2;
      ctx.fillText(label, lx, ly);
    }

    if (draftRect && draftRect.w !== 0 && draftRect.h !== 0) {
      const { x, y, w, h } = draftRect;
      ctx.fillStyle = "rgba(37, 99, 235, 0.15)";
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 2 / zoom;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }

    ctx.restore();
  }, [plan, rooms, selectedId, draftRect, pan, zoom, fpW, fpH, gridPx, bgImage, viewport.w, viewport.h]);

  useEffect(() => {
    draw();
  }, [draw]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!plan) return;
    const w = clientToWorld(e.clientX, e.clientY);
    if (w.x < 0 || w.y < 0 || w.x > fpW || w.y > fpH) return;

    if (tool === "rect") {
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      setDraftRect({ x: w.x, y: w.y, w: 0, h: 0 });
      return;
    }

    const hit = hitTestRoom(w.x, w.y, rooms);
    if (hit) {
      const r = rooms.find((x) => x.id === hit);
      if (r) {
        setSelectedId(hit);
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        setDrag({ roomId: hit, startX: w.x, startY: w.y, origX: r.x, origY: r.y });
      }
    } else {
      setSelectedId(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const w = clientToWorld(e.clientX, e.clientY);
    if (draftRect) {
      const x0 = draftRect.x;
      const y0 = draftRect.y;
      setDraftRect({ x: Math.min(x0, w.x), y: Math.min(y0, w.y), w: Math.abs(w.x - x0), h: Math.abs(w.y - y0) });
      return;
    }
    if (drag) {
      const dx = w.x - drag.startX;
      const dy = w.y - drag.startY;
      setRooms((prev) =>
        prev.map((r) => (r.id === drag.roomId ? { ...r, x: drag.origX + dx, y: drag.origY + dy } : r)),
      );
      setDirty(true);
    }
  };

  const finalizeRect = (x: number, y: number, w: number, h: number) => {
    if (w < 8 || h < 8) return;
    const id = crypto.randomUUID();
    const meta = defaultMetadata();
    const size_m2 = (w / ppm) * (h / ppm);
    meta.size_m2 = size_m2;
    const roomNumber = nextRoomNumber(roomsRef.current);
    const newRow: RoomRow = {
      id,
      room_number: roomNumber,
      room_name: "",
      room_type: "office",
      bookable_space_id: null,
      x,
      y,
      width: w,
      height: h,
      rotation: 0,
      color: null,
      shape: "rect",
      polygon_points: null,
      label_x: null,
      label_y: null,
      is_rentable: true,
      metadata: meta,
    };
    setRooms((r) => [...r, newRow]);
    setSelectedId(id);
    setDirty(true);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draftRect) {
      const { x, y, w, h } = draftRect;
      setDraftRect(null);
      try {
        (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (w >= 8 && h >= 8) finalizeRect(x, y, w, h);
      return;
    }
    if (drag) {
      setDrag(null);
      try {
        (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) * canvas.width) / rect.width;
    const py = ((e.clientY - rect.top) * canvas.height) / rect.height;
    const old = zoom;
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    const next = Math.min(3, Math.max(0.15, old + delta));
    const wx = (px - pan.x) / old;
    const wy = (py - pan.y) / old;
    setPan({ x: px - wx * next, y: py - wy * next });
    setZoom(next);
  };

  const selectedRoom = useMemo(() => rooms.find((r) => r.id === selectedId) ?? null, [rooms, selectedId]);

  const updateSelected = (patch: Partial<RoomRow>) => {
    if (!selectedId) return;
    setRooms((prev) => prev.map((r) => (r.id === selectedId ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (error && !plan) return <p style={{ padding: 24, color: "#b00020" }}>{error}</p>;
  if (!plan) return <p style={{ padding: 24 }}>Not found.</p>;

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "16px" }}>
      <div style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <Link href="/floor-plans">← Floor planner</Link>
        <h1 style={{ margin: 0, flex: "1 1 auto", fontSize: 20 }}>{plan.name}</h1>
        <button
          type="button"
          onClick={() => void save(true)}
          style={{
            padding: "8px 16px",
            background: "#1a4a4a",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save"}
        </button>
      </div>

      {error ? <p style={{ color: "#b00020", marginBottom: 8 }}>{error}</p> : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontWeight: 600, marginRight: 4 }}>Tool:</span>
          <button
            type="button"
            onClick={() => setTool("select")}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: tool === "select" ? "2px solid #1a4a4a" : "1px solid #ccc",
              background: tool === "select" ? "#e8f4f3" : "#fff",
              cursor: "pointer",
            }}
          >
            Select / move
          </button>
          <button
            type="button"
            onClick={() => setTool("rect")}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: tool === "rect" ? "2px solid #1a4a4a" : "1px solid #ccc",
              background: tool === "rect" ? "#e8f4f3" : "#fff",
              cursor: "pointer",
            }}
          >
            Rectangle room
          </button>
          <span style={{ color: "#64748b", fontSize: 13 }}>
            Scroll to zoom · Drag rooms in Select mode · Draw rooms in Rectangle mode
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 16, alignItems: "flex-start" }}>
        <div ref={wrapRef} style={{ flex: "1 1 480px", minWidth: 280 }}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            style={{ display: "block", border: "1px solid #e5e7eb", borderRadius: 12, cursor: tool === "rect" ? "crosshair" : "default", touchAction: "none" }}
          />
        </div>

        <aside style={{ width: 300, minWidth: 260, border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, fontSize: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Room properties</div>
          {selectedRoom ? (
            <div style={{ display: "grid", gap: 10 }}>
              <label>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Number</div>
                <input
                  value={selectedRoom.room_number}
                  onChange={(e) => updateSelected({ room_number: e.target.value })}
                  style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Name</div>
                <input
                  value={selectedRoom.room_name}
                  onChange={(e) => updateSelected({ room_name: e.target.value })}
                  style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Type</div>
                <select
                  value={(FLOOR_PLAN_ROOM_TYPES as readonly string[]).includes(selectedRoom.room_type) ? selectedRoom.room_type : "other"}
                  onChange={(e) => updateSelected({ room_type: e.target.value })}
                  style={{ width: "100%", padding: 8 }}
                >
                  {FLOOR_PLAN_ROOM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ROOM_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={selectedRoom.is_rentable}
                  onChange={(e) => updateSelected({ is_rentable: e.target.checked })}
                />
                Rentable
              </label>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Position: {Math.round(selectedRoom.x)}, {Math.round(selectedRoom.y)} · Size: {Math.round(selectedRoom.width)} × {Math.round(selectedRoom.height)} px
              </div>
            </div>
          ) : (
            <p style={{ color: "#6b7280", margin: 0 }}>Click a room to edit properties, or draw a new rectangle.</p>
          )}
        </aside>
      </div>
    </main>
  );
}
