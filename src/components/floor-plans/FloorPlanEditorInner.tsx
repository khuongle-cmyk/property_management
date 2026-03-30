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

type Tool = "select" | "rect" | "wall";
type ScalePreset = "1:50" | "1:100" | "1:200" | "custom";
type GridMode = "show" | "hide" | "dots";

const SCALE_PRESET_CM: Record<Exclude<ScalePreset, "custom">, number> = {
  "1:50": 2,
  "1:100": 1,
  "1:200": 0.5,
};

const DEFAULT_CM_PER_PIXEL = 10;

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function ppmFromCmPerPixel(cm: number): number {
  if (cm <= 0) return 10;
  return 100 / cm;
}

function nextRoomNumber(rooms: RoomRow[]): string {
  let max = 100;
  for (const r of rooms) {
    const m = parseInt(String(r.room_number).replace(/\D/g, ""), 10);
    if (Number.isFinite(m) && m >= max) max = m + 1;
  }
  return String(max);
}

function roomMeters(widthPx: number, heightPx: number, cmPerPixel: number) {
  const wM = (widthPx * cmPerPixel) / 100;
  const hM = (heightPx * cmPerPixel) / 100;
  return { widthM: wM, heightM: hM, areaM2: wM * hM };
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

function loadBackgroundImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const attempt = (useCors: boolean) => {
      const img = new Image();
      if (useCors) img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => {
        if (useCors) attempt(false);
        else resolve(null);
      };
      img.src = url;
    };
    attempt(true);
  });
}

function parseCanvasData(raw: Record<string, unknown> | undefined): {
  cmPerPixel: number;
  scalePreset: ScalePreset;
  gridMode: GridMode;
} {
  const g = raw?.grid_mode;
  const gridMode: GridMode = g === "hide" || g === "dots" ? g : "show";
  const presetRaw = raw?.scale_preset;
  const scalePreset: ScalePreset =
    presetRaw === "1:50" || presetRaw === "1:100" || presetRaw === "1:200" || presetRaw === "custom" ? presetRaw : "custom";
  let cmPerPixel = num(raw?.cm_per_pixel, NaN);
  if (!Number.isFinite(cmPerPixel) || cmPerPixel <= 0) cmPerPixel = DEFAULT_CM_PER_PIXEL;
  return { cmPerPixel, scalePreset, gridMode };
}

export default function FloorPlanEditorInner({ floorPlanId }: { floorPlanId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [viewport, setViewport] = useState({ w: 920, h: 560 });
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [elements, setElements] = useState<ElementRow[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 24, y: 24 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [dirty, setDirty] = useState(false);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);

  const [cmPerPixel, setCmPerPixel] = useState(DEFAULT_CM_PER_PIXEL);
  const [scalePreset, setScalePreset] = useState<ScalePreset>("custom");
  const [customCmInput, setCustomCmInput] = useState(String(DEFAULT_CM_PER_PIXEL));
  const [gridMode, setGridMode] = useState<GridMode>("show");

  const [draftRect, setDraftRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [draftWall, setDraftWall] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [drag, setDrag] = useState<{ roomId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [panDrag, setPanDrag] = useState<{ startClientX: number; startClientY: number; startPanX: number; startPanY: number } | null>(
    null,
  );
  const [spaceDown, setSpaceDown] = useState(false);

  const roomsRef = useRef(rooms);
  const elementsRef = useRef(elements);
  const planRef = useRef(plan);
  const cmRef = useRef(cmPerPixel);
  const gridModeRef = useRef(gridMode);
  const scalePresetRef = useRef(scalePreset);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    roomsRef.current = rooms;
    elementsRef.current = elements;
    planRef.current = plan;
    cmRef.current = cmPerPixel;
    gridModeRef.current = gridMode;
    scalePresetRef.current = scalePreset;
    panRef.current = pan;
    zoomRef.current = zoom;
  }, [rooms, elements, plan, cmPerPixel, gridMode, scalePreset, pan, zoom]);

  const ppm = ppmFromCmPerPixel(cmPerPixel);
  const fpW = plan ? Math.max(1, num(plan.width_meters, 20) * ppm) : 800;
  const fpH = plan ? Math.max(1, num(plan.height_meters, 15) * ppm) : 600;
  const gridStepWorld = 0.5 * ppm;

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
    const canvasRaw = (p.canvas_data ?? {}) as Record<string, unknown>;
    const parsed = parseCanvasData(canvasRaw);
    const scaleNum = num(p.scale, 100);
    let cm = parsed.cmPerPixel;
    if (!canvasRaw.cm_per_pixel && scaleNum > 0) {
      cm = 100 / scaleNum;
    }
    setCmPerPixel(cm);
    setCustomCmInput(String(cm));
    setScalePreset(parsed.scalePreset);
    setGridMode(parsed.gridMode);

    setPlan({
      ...p,
      width_meters: num(p.width_meters, 20),
      height_meters: num(p.height_meters, 15),
      scale: scaleNum,
      background_opacity: p.background_opacity !== undefined && p.background_opacity !== null ? num(p.background_opacity, 0.5) : 0.5,
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
        points: Array.isArray(el.points) ? (el.points as number[]) : null,
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
      setViewport({ w: Math.max(320, Math.min(1100, r.width)), h: Math.max(360, Math.min(720, window.innerHeight - 280)) });
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
    let cancelled = false;
    void loadBackgroundImage(plan.background_image_url).then((img) => {
      if (!cancelled) setBgImage(img);
    });
    return () => {
      cancelled = true;
    };
  }, [plan?.background_image_url, plan?.show_background]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      e.preventDefault();
      setSpaceDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const buildCanvasData = useCallback(() => {
    const p = planRef.current;
    const base = { ...(p?.canvas_data ?? {}) };
    base.cm_per_pixel = cmRef.current;
    base.scale_preset = scalePresetRef.current;
    base.grid_mode = gridModeRef.current;
    return base;
  }, []);

  const save = useCallback(async (showDone = true) => {
    const p = planRef.current;
    const rs = roomsRef.current;
    const els = elementsRef.current;
    if (!p) return;
    setSaveState("saving");
    const cm = cmRef.current;
    const scaleOut = ppmFromCmPerPixel(cm);
    const body = {
      name: p.name,
      floor_number: p.floor_number,
      width_meters: p.width_meters,
      height_meters: p.height_meters,
      scale: scaleOut,
      background_image_url: p.background_image_url,
      background_opacity: p.background_opacity,
      show_background: p.show_background,
      status: p.status,
      canvas_data: buildCanvasData(),
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
    setPlan((prev) => (prev ? { ...prev, scale: scaleOut, canvas_data: buildCanvasData() as Record<string, unknown> } : prev));
    setDirty(false);
    if (showDone) setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 1600);
  }, [floorPlanId, buildCanvasData]);

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

  const zoomAtScreenPoint = useCallback((nextZoom: number, screenX: number, screenY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = ((screenX - rect.left) * canvas.width) / rect.width;
    const py = ((screenY - rect.top) * canvas.height) / rect.height;
    const oldZ = zoomRef.current;
    const p = panRef.current;
    const wx = (px - p.x) / oldZ;
    const wy = (py - p.y) / oldZ;
    const z = Math.min(3, Math.max(0.05, nextZoom));
    setPan({ x: px - wx * z, y: py - wy * z });
    setZoom(z);
  }, []);

  const fitToView = useCallback(() => {
    const vw = viewport.w;
    const vh = viewport.h;
    const m = 32;
    const zx = (vw - m) / fpW;
    const zy = (vh - m) / fpH;
    const z = Math.min(3, Math.max(0.05, Math.min(zx, zy)));
    const panX = (vw - fpW * z) / 2;
    const panY = (vh - fpH * z) / 2;
    setZoom(z);
    setPan({ x: panX, y: panY });
  }, [viewport.w, viewport.h, fpW, fpH]);

  const zoomTo100 = useCallback(() => {
    const vw = viewport.w;
    const vh = viewport.h;
    setZoom(1);
    setPan({ x: (vw - fpW) / 2, y: (vh - fpH) / 2 });
  }, [viewport.w, viewport.h, fpW, fpH]);

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
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(0, 0, vw, vh);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    const bgOp = num(plan.background_opacity, 0.5);

    if (bgImage && plan.show_background) {
      ctx.globalAlpha = bgOp;
      ctx.drawImage(bgImage, 0, 0, fpW, fpH);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, fpW, fpH);
    }

    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2 / zoom;
    ctx.strokeRect(0, 0, fpW, fpH);

    if (gridMode !== "hide") {
      ctx.strokeStyle = gridMode === "dots" ? "#d1d5db" : "#e5e7eb";
      ctx.lineWidth = 1 / zoom;
      if (gridMode === "dots") {
        for (let x = gridStepWorld; x < fpW; x += gridStepWorld) {
          for (let y = gridStepWorld; y < fpH; y += gridStepWorld) {
            ctx.beginPath();
            ctx.arc(x, y, 1.2 / zoom, 0, Math.PI * 2);
            ctx.fillStyle = "#cbd5e1";
            ctx.fill();
          }
        }
      } else {
        for (let x = 0; x <= fpW; x += gridStepWorld) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, fpH);
          ctx.stroke();
        }
        for (let y = 0; y <= fpH; y += gridStepWorld) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(fpW, y);
          ctx.stroke();
        }
      }
    }

    for (const el of elements) {
      if (el.element_type !== "wall" || !el.points || el.points.length < 4) continue;
      const [x1, y1, x2, y2] = el.points;
      const sw = num(el.style?.strokeWidth, 3);
      ctx.strokeStyle = String(el.style?.stroke ?? "#374151");
      ctx.lineWidth = sw / zoom;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
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
      ctx.fillText(label, r.x + r.width / 2, r.y + r.height / 2);
    }

    if (draftRect && draftRect.w !== 0 && draftRect.h !== 0) {
      const { x, y, w, h } = draftRect;
      ctx.fillStyle = "rgba(37, 99, 235, 0.15)";
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 2 / zoom;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }

    if (draftWall) {
      const { x1, y1, x2, y2 } = draftWall;
      ctx.strokeStyle = "#374151";
      ctx.lineWidth = 3 / zoom;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [
    plan,
    rooms,
    elements,
    selectedId,
    draftRect,
    draftWall,
    pan,
    zoom,
    fpW,
    fpH,
    gridStepWorld,
    bgImage,
    viewport.w,
    viewport.h,
    gridMode,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  const drawMinimap = useCallback(() => {
    const mini = minimapRef.current;
    if (!mini || !plan) return;
    const ctx = mini.getContext("2d");
    if (!ctx) return;
    const mw = 168;
    const mh = 112;
    mini.width = mw;
    mini.height = mh;
    const s = Math.min(mw / fpW, mh / fpH);
    const ox = (mw - fpW * s) / 2;
    const oy = (mh - fpH * s) / 2;

    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, mw, mh);
    ctx.strokeStyle = "#94a3b8";
    ctx.strokeRect(ox, oy, fpW * s, fpH * s);

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(ox, oy, fpW * s, fpH * s);

    for (const r of rooms) {
      ctx.fillStyle = "#cbd5e1";
      ctx.fillRect(ox + r.x * s, oy + r.y * s, Math.max(1, r.width * s), Math.max(1, r.height * s));
    }

    const vw = viewport.w;
    const vh = viewport.h;
    const wx0 = -pan.x / zoom;
    const wy0 = -pan.y / zoom;
    const wx1 = (vw - pan.x) / zoom;
    const wy1 = (vh - pan.y) / zoom;
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + wx0 * s, oy + wy0 * s, (wx1 - wx0) * s, (wy1 - wy0) * s);
  }, [plan, rooms, fpW, fpH, pan, zoom, viewport.w, viewport.h]);

  useEffect(() => {
    drawMinimap();
  }, [drawMinimap]);

  const applyPreset = (preset: ScalePreset) => {
    setScalePreset(preset);
    if (preset !== "custom") {
      const cm = SCALE_PRESET_CM[preset];
      setCmPerPixel(cm);
      setCustomCmInput(String(cm));
    }
    setDirty(true);
  };

  const applyCustomCm = (raw: string) => {
    setCustomCmInput(raw);
    const v = parseFloat(raw.replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) return;
    setCmPerPixel(v);
    setScalePreset("custom");
    setDirty(true);
  };

  const finalizeRect = (x: number, y: number, w: number, h: number) => {
    if (w < 8 || h < 8) return;
    const id = crypto.randomUUID();
    const meta = { ...defaultMetadata() } as Record<string, unknown>;
    const cm = cmRef.current;
    const { areaM2, widthM, heightM } = roomMeters(w, h, cm);
    meta.size_m2 = areaM2;
    meta.width_meters = widthM;
    meta.height_meters = heightM;
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
      metadata: meta as RoomRow["metadata"],
    };
    setRooms((r) => [...r, newRow]);
    setSelectedId(id);
    setDirty(true);
  };

  const finalizeWall = (x1: number, y1: number, x2: number, y2: number) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 4) return;
    const id = crypto.randomUUID();
    const newEl: ElementRow = {
      id,
      element_type: "wall",
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
      rotation: 0,
      points: [x1, y1, x2, y2],
      style: { stroke: "#374151", strokeWidth: 3 },
      label: null,
    };
    setElements((e) => [...e, newEl]);
    setDirty(true);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!plan) return;
    const canvas = e.currentTarget;

    if (e.button === 1) {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const p0 = panRef.current;
      setPanDrag({ startClientX: e.clientX, startClientY: e.clientY, startPanX: p0.x, startPanY: p0.y });
      return;
    }

    const w = clientToWorld(e.clientX, e.clientY);
    const inFloor = w.x >= 0 && w.y >= 0 && w.x <= fpW && w.y <= fpH;

    if (spaceDown && e.button === 0) {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const p0 = panRef.current;
      setPanDrag({ startClientX: e.clientX, startClientY: e.clientY, startPanX: p0.x, startPanY: p0.y });
      return;
    }

    if (!inFloor) return;

    if (tool === "rect") {
      canvas.setPointerCapture(e.pointerId);
      setDraftRect({ x: w.x, y: w.y, w: 0, h: 0 });
      return;
    }

    if (tool === "wall") {
      canvas.setPointerCapture(e.pointerId);
      setDraftWall({ x1: w.x, y1: w.y, x2: w.x, y2: w.y });
      return;
    }

    const hit = hitTestRoom(w.x, w.y, rooms);
    if (hit) {
      const r = rooms.find((x) => x.id === hit);
      if (r) {
        setSelectedId(hit);
        canvas.setPointerCapture(e.pointerId);
        setDrag({ roomId: hit, startX: w.x, startY: w.y, origX: r.x, origY: r.y });
      }
    } else {
      setSelectedId(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (panDrag) {
      const dx = e.clientX - panDrag.startClientX;
      const dy = e.clientY - panDrag.startClientY;
      setPan({ x: panDrag.startPanX + dx, y: panDrag.startPanY + dy });
      return;
    }
    const w = clientToWorld(e.clientX, e.clientY);
    if (draftRect) {
      const x0 = draftRect.x;
      const y0 = draftRect.y;
      setDraftRect({ x: Math.min(x0, w.x), y: Math.min(y0, w.y), w: Math.abs(w.x - x0), h: Math.abs(w.y - y0) });
      return;
    }
    if (draftWall) {
      setDraftWall({ ...draftWall, x2: w.x, y2: w.y });
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

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    if (panDrag) {
      setPanDrag(null);
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }
    if (draftRect) {
      const { x, y, w, h } = draftRect;
      setDraftRect(null);
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (w >= 8 && h >= 8) finalizeRect(x, y, w, h);
      return;
    }
    if (draftWall) {
      const { x1, y1, x2, y2 } = draftWall;
      setDraftWall(null);
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      finalizeWall(x1, y1, x2, y2);
      return;
    }
    if (drag) {
      setDrag(null);
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!plan) return;
    const w = clientToWorld(e.clientX, e.clientY);
    if (w.x < 0 || w.y < 0 || w.x > fpW || w.y > fpH) return;
    if (hitTestRoom(w.x, w.y, rooms)) return;
    fitToView();
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const old = zoom;
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const next = Math.min(3, Math.max(0.05, old + delta));
    zoomAtScreenPoint(next, e.clientX, e.clientY);
  };

  const selectedRoom = useMemo(() => rooms.find((r) => r.id === selectedId) ?? null, [rooms, selectedId]);

  const updateSelected = (patch: Partial<RoomRow>) => {
    if (!selectedId) return;
    setRooms((prev) => prev.map((r) => (r.id === selectedId ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const deleteSelectedRoom = () => {
    if (!selectedId) return;
    setRooms((prev) => prev.filter((r) => r.id !== selectedId));
    setSelectedId(null);
    setDirty(true);
  };

  const zoomPct = Math.round(zoom * 100);

  const selectedDims = useMemo(() => {
    if (!selectedRoom) return null;
    return roomMeters(selectedRoom.width, selectedRoom.height, cmPerPixel);
  }, [selectedRoom, cmPerPixel]);

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (error && !plan) return <p style={{ padding: 24, color: "#b00020" }}>{error}</p>;
  if (!plan) return <p style={{ padding: 24 }}>Not found.</p>;

  const toolbarBtn = (active: boolean) => ({
    padding: "6px 10px",
    borderRadius: 6,
    border: active ? "2px solid #1a4a4a" : "1px solid #ccc",
    background: active ? "#e8f4f3" : "#fff",
    cursor: "pointer" as const,
    fontSize: 13,
  });

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

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          marginBottom: 10,
          padding: "10px 12px",
          background: "#f8fafc",
          borderRadius: 10,
          border: "1px solid #e2e8f0",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>Tools</span>
        <button type="button" onClick={() => setTool("select")} style={toolbarBtn(tool === "select")}>
          Select
        </button>
        <button type="button" onClick={() => setTool("rect")} style={toolbarBtn(tool === "rect")}>
          Draw room
        </button>
        <button type="button" onClick={() => setTool("wall")} style={toolbarBtn(tool === "wall")}>
          Draw wall
        </button>

        <span style={{ width: 1, height: 22, background: "#cbd5e1", margin: "0 4px" }} />

        <button
          type="button"
          title="Zoom in"
          onClick={() => {
            const c = canvasRef.current;
            if (!c) return;
            const r = c.getBoundingClientRect();
            zoomAtScreenPoint(zoom * 1.15, r.left + r.width / 2, r.top + r.height / 2);
          }}
          style={toolbarBtn(false)}
        >
          +
        </button>
        <button
          type="button"
          title="Zoom out"
          onClick={() => {
            const c = canvasRef.current;
            if (!c) return;
            const r = c.getBoundingClientRect();
            zoomAtScreenPoint(zoom / 1.15, r.left + r.width / 2, r.top + r.height / 2);
          }}
          style={toolbarBtn(false)}
        >
          −
        </button>
        <button type="button" title="100% zoom" onClick={() => zoomTo100()} style={toolbarBtn(false)}>
          100%
        </button>
        <button type="button" title="Fit to view" onClick={() => fitToView()} style={toolbarBtn(false)}>
          Fit
        </button>
        <span style={{ fontSize: 13, color: "#334155", fontWeight: 600, minWidth: 48 }}>{zoomPct}%</span>

        <span style={{ width: 1, height: 22, background: "#cbd5e1", margin: "0 4px" }} />

        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          Scale
          <select
            value={scalePreset}
            onChange={(e) => applyPreset(e.target.value as ScalePreset)}
            style={{ padding: "4px 8px", borderRadius: 6, fontSize: 13 }}
          >
            <option value="1:50">1:50</option>
            <option value="1:100">1:100</option>
            <option value="1:200">1:200</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {scalePreset === "custom" ? (
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            1 px ={" "}
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={customCmInput}
              onChange={(e) => applyCustomCm(e.target.value)}
              style={{ width: 64, padding: 4 }}
            />{" "}
            cm
          </label>
        ) : null}

        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          Grid
          <select value={gridMode} onChange={(e) => { setGridMode(e.target.value as GridMode); setDirty(true); }} style={{ padding: "4px 8px", borderRadius: 6 }}>
            <option value="show">Show</option>
            <option value="hide">Hide</option>
            <option value="dots">Dots</option>
          </select>
        </label>

        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          Background opacity
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={num(plan.background_opacity, 0.5)}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setPlan((p) => (p ? { ...p, background_opacity: v } : p));
              setDirty(true);
            }}
          />
          <span style={{ minWidth: 40 }}>{Math.round(num(plan.background_opacity, 0.5) * 100)}%</span>
        </label>
      </div>

      <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b" }}>
        Scroll wheel: zoom · Middle-drag or Space+drag: pan · Double-click empty: fit · 1 px = {cmPerPixel.toFixed(2)} cm (
        {ppmFromCmPerPixel(cmPerPixel).toFixed(2)} px/m)
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div ref={wrapRef} style={{ flex: "1 1 480px", minWidth: 280, position: "relative" }}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            onDoubleClick={onDoubleClick}
            onAuxClick={(e) => e.button === 1 && e.preventDefault()}
            style={{
              display: "block",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              cursor:
                tool === "rect" || tool === "wall"
                  ? "crosshair"
                  : spaceDown
                    ? "grab"
                    : "default",
              touchAction: "none",
              outline: "none",
            }}
          />
          <canvas
            ref={minimapRef}
            width={168}
            height={112}
            style={{
              position: "absolute",
              left: 8,
              bottom: 8,
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              background: "#fff",
              pointerEvents: "none",
            }}
          />
        </div>

        <aside style={{ width: 300, minWidth: 260, border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, fontSize: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Room properties</div>
          {selectedRoom && selectedDims ? (
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
                  onChange={(e) => {
                    const t = e.target.value;
                    const rt = (FLOOR_PLAN_ROOM_TYPES as readonly string[]).includes(t) ? (t as FloorPlanRoomType) : "other";
                    updateSelected({ room_type: t, color: ROOM_TYPE_COLORS[rt].fill });
                  }}
                  style={{ width: "100%", padding: 8 }}
                >
                  {FLOOR_PLAN_ROOM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ROOM_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Size</div>
                <div style={{ fontWeight: 600 }}>{selectedDims.areaM2.toFixed(1)} m²</div>
              </div>
              <div style={{ fontSize: 13, color: "#374151" }}>
                Width: {selectedDims.widthM.toFixed(1)} m · Height: {selectedDims.heightM.toFixed(1)} m
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={selectedRoom.is_rentable}
                  onChange={(e) => updateSelected({ is_rentable: e.target.checked })}
                />
                Rentable
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>Color</span>
                <input
                  type="color"
                  value={(() => {
                    const c = selectedRoom.color;
                    if (c && /^#[0-9A-Fa-f]{6}$/.test(c)) return c;
                    const rt = (FLOOR_PLAN_ROOM_TYPES as readonly string[]).includes(selectedRoom.room_type)
                      ? (selectedRoom.room_type as FloorPlanRoomType)
                      : "other";
                    return ROOM_TYPE_COLORS[rt].fill;
                  })()}
                  onChange={(e) => updateSelected({ color: e.target.value })}
                  style={{ width: 40, height: 32, padding: 0, border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" }}
                />
                <span style={{ fontSize: 12, color: "#94a3b8" }}>Type default or custom</span>
              </label>
              <button
                type="button"
                onClick={deleteSelectedRoom}
                style={{
                  marginTop: 4,
                  padding: "8px 12px",
                  background: "#b91c1c",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Delete room
              </button>
            </div>
          ) : (
            <p style={{ color: "#6b7280", margin: 0 }}>Click a room to edit, or draw a new room.</p>
          )}
        </aside>
      </div>
    </main>
  );
}
