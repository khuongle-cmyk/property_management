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

type Tool = "select" | "move" | "rect" | "wall" | "calibrate";

const MAX_HISTORY = 50;

type RoomsElementsSnapshot = { rooms: RoomRow[]; elements: ElementRow[] };

function cloneSnapshot(rooms: RoomRow[], elements: ElementRow[]): RoomsElementsSnapshot {
  return { rooms: structuredClone(rooms), elements: structuredClone(elements) };
}
type GridMode = "show" | "hide" | "dots";

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

const MIN_ROOM_PX = 8;
const HANDLE_SCREEN_PX = 8;

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

function isRectLikeRoom(r: RoomRow): boolean {
  if (r.shape === "polygon" && Array.isArray(r.polygon_points) && (r.polygon_points as number[]).length >= 6) {
    return false;
  }
  return true;
}

function cursorForResizeHandle(h: ResizeHandle): string {
  switch (h) {
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "n":
    case "s":
      return "ns-resize";
    default:
      return "default";
  }
}

/** Hit test resize handles; corners checked before edges so corners win near intersections. */
function hitTestResizeHandle(wx: number, wy: number, r: RoomRow, zoom: number): ResizeHandle | null {
  if (!isRectLikeRoom(r)) return null;
  const hitR = 6 / zoom;
  const { x, y, width: w, height: h } = r;
  const centers: Record<ResizeHandle, [number, number]> = {
    nw: [x, y],
    ne: [x + w, y],
    sw: [x, y + h],
    se: [x + w, y + h],
    n: [x + w / 2, y],
    s: [x + w / 2, y + h],
    e: [x + w, y + h / 2],
    w: [x, y + h / 2],
  };
  const order: ResizeHandle[] = ["nw", "ne", "sw", "se", "n", "e", "s", "w"];
  for (const key of order) {
    const [cx, cy] = centers[key];
    if (Math.hypot(wx - cx, wy - cy) <= hitR) return key;
  }
  return null;
}

function applyResizeFromDelta(
  handle: ResizeHandle,
  ox: number,
  oy: number,
  ow: number,
  oh: number,
  dx: number,
  dy: number,
  fpW: number,
  fpH: number,
): { x: number; y: number; width: number; height: number } {
  const MIN = MIN_ROOM_PX;
  let x = ox;
  let y = oy;
  let w = ow;
  let h = oh;
  switch (handle) {
    case "se":
      w = Math.max(MIN, ow + dx);
      h = Math.max(MIN, oh + dy);
      x = ox;
      y = oy;
      break;
    case "nw":
      w = Math.max(MIN, ow - dx);
      h = Math.max(MIN, oh - dy);
      x = ox + ow - w;
      y = oy + oh - h;
      break;
    case "ne":
      w = Math.max(MIN, ow + dx);
      h = Math.max(MIN, oh - dy);
      x = ox;
      y = oy + oh - h;
      break;
    case "sw":
      w = Math.max(MIN, ow - dx);
      h = Math.max(MIN, oh + dy);
      x = ox + ow - w;
      y = oy;
      break;
    case "e":
      w = Math.max(MIN, ow + dx);
      h = oh;
      x = ox;
      y = oy;
      break;
    case "w":
      w = Math.max(MIN, ow - dx);
      h = oh;
      x = ox + ow - w;
      y = oy;
      break;
    case "s":
      w = ow;
      h = Math.max(MIN, oh + dy);
      x = ox;
      y = oy;
      break;
    case "n":
      w = ow;
      h = Math.max(MIN, oh - dy);
      x = ox;
      y = oy + oh - h;
      break;
  }
  w = Math.max(MIN, Math.min(w, fpW));
  h = Math.max(MIN, Math.min(h, fpH));
  x = Math.max(0, Math.min(fpW - w, x));
  y = Math.max(0, Math.min(fpH - h, y));
  return { x, y, width: w, height: h };
}

/** Real-world size from room geometry and scale (cm per pixel). */
function roomDimsMeters(r: RoomRow, cmPerPixel: number) {
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
    const wPx = maxX - minX;
    const hPx = maxY - minY;
    return roomMeters(wPx, hPx, cmPerPixel);
  }
  return roomMeters(r.width, r.height, cmPerPixel);
}

function drawImageContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  alpha: number,
) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (iw <= 0 || ih <= 0) return;
  const scale = Math.min(boxW / iw, boxH / ih);
  const w = iw * scale;
  const h = ih * scale;
  const x = boxX + (boxW - w) / 2;
  const y = boxY + (boxH - h) / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

/** Prefer loading without crossOrigin first (same-origin / signed URLs often work without CORS). */
function loadBackgroundImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const attempt = (useCors: boolean) => {
      const img = new Image();
      if (useCors) img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => {
        if (!useCors) attempt(true);
        else resolve(null);
      };
      img.src = url;
    };
    attempt(false);
  });
}

function backgroundUrlIsPdf(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    const base = url.split("?")[0].split("#")[0];
    return base.toLowerCase().endsWith(".pdf");
  }
}

/** Render first PDF page to an image via PDF.js (client-only). */
async function loadBackgroundPdf(url: string): Promise<HTMLImageElement | null> {
  try {
    console.log("[PDF background] fetching URL:", url);
    const pdfjs = await import("pdfjs-dist");
    console.log("[PDF background] PDF.js loaded successfully");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    }
    const res = await fetch(url);
    if (!res.ok) {
      console.log("[PDF background] fetch failed:", res.status, res.statusText);
      return null;
    }
    console.log("[PDF background] fetch succeeded");
    const data = new Uint8Array(await res.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const scale = 2;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const w = Math.ceil(viewport.width);
    const h = Math.ceil(viewport.height);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/png");
    return await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  } catch (err) {
    console.error("[PDF background]", err);
    return null;
  }
}

function parseCanvasData(raw: Record<string, unknown> | undefined): {
  cmPerPixel: number;
  gridMode: GridMode;
} {
  const g = raw?.grid_mode;
  const gridMode: GridMode = g === "hide" || g === "dots" ? g : "show";
  let cmPerPixel = num(raw?.cm_per_pixel, NaN);
  if (!Number.isFinite(cmPerPixel) || cmPerPixel <= 0) cmPerPixel = DEFAULT_CM_PER_PIXEL;
  return { cmPerPixel, gridMode };
}

export default function FloorPlanEditorInner({
  floorPlanId,
  detectedScale,
}: {
  floorPlanId: string;
  /** Architectural scale from PDF (1:N → N), or null if PDF had no scale text, or undefined if not applicable. */
  detectedScale?: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);

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
  const [exportingPdf, setExportingPdf] = useState(false);
  const [dirty, setDirty] = useState(false);
  /** Bumps when background image ref is set/cleared so draw() re-runs. */
  const [bgEpoch, setBgEpoch] = useState(0);

  const [cmPerPixel, setCmPerPixel] = useState(DEFAULT_CM_PER_PIXEL);
  const [gridMode, setGridMode] = useState<GridMode>("show");
  const [pdfScaleDetectedBannerDismissed, setPdfScaleDetectedBannerDismissed] = useState(false);
  const [pdfScaleUnknownBannerDismissed, setPdfScaleUnknownBannerDismissed] = useState(false);
  const appliedPdfDetectedScaleRef = useRef(false);

  const [draftRect, setDraftRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [draftWall, setDraftWall] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [draftCalibrate, setDraftCalibrate] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [calibrateDialog, setCalibrateDialog] = useState<{ pixelLength: number } | null>(null);
  const [calibrateMetersDraft, setCalibrateMetersDraft] = useState("");
  const [drag, setDrag] = useState<{ roomId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [resize, setResize] = useState<{
    roomId: string;
    handle: ResizeHandle;
    startX: number;
    startY: number;
    orig: { x: number; y: number; width: number; height: number };
  } | null>(null);
  /** Select tool only: hover target for cursor (handles use ResizeHandle; room body uses "move"). */
  const [selectHover, setSelectHover] = useState<ResizeHandle | "move" | null>(null);
  const [panDrag, setPanDrag] = useState<{ startClientX: number; startClientY: number; startPanX: number; startPanY: number } | null>(
    null,
  );
  const [spaceDown, setSpaceDown] = useState(false);

  const undoStackRef = useRef<RoomsElementsSnapshot[]>([]);
  const redoStackRef = useRef<RoomsElementsSnapshot[]>([]);
  const skipHistoryRef = useRef(false);
  const [undoLen, setUndoLen] = useState(0);
  const [redoLen, setRedoLen] = useState(0);

  const roomsRef = useRef(rooms);
  const elementsRef = useRef(elements);
  const planRef = useRef(plan);
  const cmRef = useRef(cmPerPixel);
  const gridModeRef = useRef(gridMode);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    roomsRef.current = rooms;
    elementsRef.current = elements;
    planRef.current = plan;
    cmRef.current = cmPerPixel;
    gridModeRef.current = gridMode;
    panRef.current = pan;
    zoomRef.current = zoom;
  }, [rooms, elements, plan, cmPerPixel, gridMode, pan, zoom]);

  const commitHistory = useCallback(() => {
    if (skipHistoryRef.current) return;
    const snap = cloneSnapshot(roomsRef.current, elementsRef.current);
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_HISTORY - 1)), snap];
    redoStackRef.current = [];
    setUndoLen(undoStackRef.current.length);
    setRedoLen(0);
  }, []);

  const applyUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const snapshot = undoStackRef.current.pop()!;
    const cur = cloneSnapshot(roomsRef.current, elementsRef.current);
    redoStackRef.current = [...redoStackRef.current.slice(-(MAX_HISTORY - 1)), cur];
    skipHistoryRef.current = true;
    setRooms(snapshot.rooms);
    setElements(snapshot.elements);
    skipHistoryRef.current = false;
    setUndoLen(undoStackRef.current.length);
    setRedoLen(redoStackRef.current.length);
    setSelectedId((sid) => (sid && snapshot.rooms.some((r) => r.id === sid) ? sid : null));
    setDirty(true);
  }, []);

  const applyRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const snapshot = redoStackRef.current.pop()!;
    const cur = cloneSnapshot(roomsRef.current, elementsRef.current);
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_HISTORY - 1)), cur];
    skipHistoryRef.current = true;
    setRooms(snapshot.rooms);
    setElements(snapshot.elements);
    skipHistoryRef.current = false;
    setUndoLen(undoStackRef.current.length);
    setRedoLen(redoStackRef.current.length);
    setSelectedId((sid) => (sid && snapshot.rooms.some((r) => r.id === sid) ? sid : null));
    setDirty(true);
  }, []);

  const ppm = ppmFromCmPerPixel(cmPerPixel);
  const fpW = plan ? Math.max(1, num(plan.width_meters, 20) * ppm) : 800;
  const fpH = plan ? Math.max(1, num(plan.height_meters, 15) * ppm) : 600;
  const gridStepWorld = 0.5 * ppm;

  const MINIMAP_W = 168;
  const MINIMAP_H = 112;

  const [minimapDragging, setMinimapDragging] = useState(false);
  const minimapDragRef = useRef({ active: false, lastMx: 0, lastMy: 0, pointerId: -1 });

  const getMinimapLocal = useCallback((clientX: number, clientY: number) => {
    const el = minimapRef.current;
    if (!el) return { mx: 0, my: 0 };
    const rect = el.getBoundingClientRect();
    const mx = ((clientX - rect.left) * el.width) / rect.width;
    const my = ((clientY - rect.top) * el.height) / rect.height;
    return { mx, my };
  }, []);

  const applyMinimapDragDelta = useCallback(
    (clientX: number, clientY: number) => {
      const r = minimapDragRef.current;
      if (!r.active) return;
      const { mx, my } = getMinimapLocal(clientX, clientY);
      const dmx = mx - r.lastMx;
      const dmy = my - r.lastMy;
      r.lastMx = mx;
      r.lastMy = my;
      const s = Math.min(MINIMAP_W / fpW, MINIMAP_H / fpH);
      if (s <= 0) return;
      const z = zoomRef.current;
      setPan((p) => ({ x: p.x - (dmx / s) * z, y: p.y - (dmy / s) * z }));
    },
    [fpW, fpH, getMinimapLocal],
  );

  const onMinimapPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const canvas = e.currentTarget;
    const { mx, my } = getMinimapLocal(e.clientX, e.clientY);
    minimapDragRef.current = { active: true, lastMx: mx, lastMy: my, pointerId: e.pointerId };
    setMinimapDragging(true);
    canvas.setPointerCapture(e.pointerId);
  };

  const onMinimapPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = minimapDragRef.current;
    if (!r.active || e.pointerId !== r.pointerId) return;
    e.preventDefault();
    applyMinimapDragDelta(e.clientX, e.clientY);
  };

  const endMinimapDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = minimapDragRef.current;
    if (!r.active || e.pointerId !== r.pointerId) return;
    const pid = e.pointerId;
    r.active = false;
    r.pointerId = -1;
    setMinimapDragging(false);
    try {
      e.currentTarget.releasePointerCapture(pid);
    } catch {
      /* already released */
    }
  };


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
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoLen(0);
    setRedoLen(0);
    setLoading(false);
  }, [floorPlanId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (loading) return;
    if (appliedPdfDetectedScaleRef.current) return;
    if (detectedScale == null || !Number.isFinite(detectedScale) || detectedScale <= 0) return;
    appliedPdfDetectedScaleRef.current = true;
    // 1:N with 1 px ≈ 1 mm on paper → cm/px = N/100 (e.g. 1:150 → 1.5 cm/px).
    setCmPerPixel(detectedScale / 100);
    setDirty(true);
  }, [loading, detectedScale]);

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
    backgroundImageRef.current = null;
    if (!plan?.background_image_url || !plan.show_background) {
      setBgEpoch((n) => n + 1);
      return;
    }
    const url = plan.background_image_url;
    let cancelled = false;
    void (backgroundUrlIsPdf(url) ? loadBackgroundPdf(url) : loadBackgroundImage(url)).then((img) => {
      if (cancelled) return;
      backgroundImageRef.current = img;
      setBgEpoch((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [plan?.background_image_url, plan?.show_background]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || loading) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const oldZ = zoomRef.current;
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const nextZ = Math.min(3, Math.max(0.05, oldZ + delta));
      const rect = canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) * canvas.width) / rect.width;
      const py = ((e.clientY - rect.top) * canvas.height) / rect.height;
      const p = panRef.current;
      const wx = (px - p.x) / oldZ;
      const wy = (py - p.y) / oldZ;
      const z = Math.min(3, Math.max(0.05, nextZ));
      setPan({ x: px - wx * z, y: py - wy * z });
      setZoom(z);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [loading, plan?.id]);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        applyUndo();
        return;
      }
      if (mod && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        applyRedo();
        return;
      }
      if (mod && e.key === "y") {
        e.preventDefault();
        applyRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyUndo, applyRedo]);

  const buildCanvasData = useCallback(() => {
    const p = planRef.current;
    const base = { ...(p?.canvas_data ?? {}) };
    base.cm_per_pixel = cmRef.current;
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

  const exportFloorPlanPdf = useCallback(async () => {
    const p = planRef.current;
    if (!p) return;
    setExportingPdf(true);
    try {
      const fw = Math.max(1, Math.floor(fpW));
      const fh = Math.max(1, Math.floor(fpH));
      const outW = fw * 2;
      const outH = fh * 2;
      const c = document.createElement("canvas");
      c.width = outW;
      c.height = outH;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, fw, fh);
      const bgImg = backgroundImageRef.current;
      if (bgImg && p.show_background) {
        drawImageContain(ctx, bgImg, 0, 0, fw, fh, 1);
      }
      const rs = roomsRef.current;
      const els = elementsRef.current;
      for (const el of els) {
        if (el.element_type !== "wall" || !el.points || el.points.length < 4) continue;
        const [x1, y1, x2, y2] = el.points;
        const sw = num(el.style?.strokeWidth, 3);
        ctx.strokeStyle = String(el.style?.stroke ?? "#374151");
        ctx.lineWidth = sw;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      for (const r of rs) {
        const rt = (FLOOR_PLAN_ROOM_TYPES as readonly string[]).includes(r.room_type)
          ? (r.room_type as FloorPlanRoomType)
          : "other";
        const { fill, stroke } = ROOM_TYPE_COLORS[rt];
        ctx.fillStyle = r.color ?? fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
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
        const label = [r.room_number, r.room_name].filter(Boolean).join(" · ") || "Room";
        ctx.fillStyle = "#111827";
        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, r.x + r.width / 2, r.y + r.height / 2);
      }
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      pdf.setProperties({ title: p.name });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgData = c.toDataURL("image/png");
      const imgAspect = outW / outH;
      const pageAspect = pageW / pageH;
      let drawW: number;
      let drawH: number;
      let offX: number;
      let offY: number;
      if (imgAspect > pageAspect) {
        drawW = pageW;
        drawH = pageW / imgAspect;
        offX = 0;
        offY = (pageH - drawH) / 2;
      } else {
        drawH = pageH;
        drawW = pageH * imgAspect;
        offX = (pageW - drawW) / 2;
        offY = 0;
      }
      pdf.addImage(imgData, "PNG", offX, offY, drawW, drawH);
      const rawName = p.name?.trim() || "floor-plan";
      const safeName = rawName.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 120) || "floor-plan";
      pdf.save(`${safeName}.pdf`);
    } catch (e) {
      console.error("[floor-plan] PDF export", e);
      setError("PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  }, [fpW, fpH]);

  useEffect(() => {
    if (!dirty) return;
    const t = setInterval(() => void save(false), 30000);
    return () => clearInterval(t);
  }, [dirty, save]);

  const getCanvasPoint = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left - pan.x) / zoom,
        y: (e.clientY - rect.top - pan.y) / zoom,
      };
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

    const bgOp = Math.min(1, Math.max(0, num(plan.background_opacity, 0.5)));

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, fpW, fpH);

    const bgImg = backgroundImageRef.current;
    if (bgImg && plan.show_background) {
      drawImageContain(ctx, bgImg, 0, 0, fpW, fpH, bgOp);
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
        if (tool === "select" && isRectLikeRoom(r)) {
          const hh = HANDLE_SCREEN_PX / 2 / zoom;
          const hx = [r.x, r.x + r.width / 2, r.x + r.width];
          const hy = [r.y, r.y + r.height / 2, r.y + r.height];
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = "#2563eb";
          ctx.lineWidth = 1.5 / zoom;
          for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
              if (i === 1 && j === 1) continue;
              const cx = hx[i];
              const cy = hy[j];
              ctx.fillRect(cx - hh, cy - hh, hh * 2, hh * 2);
              ctx.strokeRect(cx - hh, cy - hh, hh * 2, hh * 2);
            }
          }
        }
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

    if (draftCalibrate) {
      const { x1, y1, x2, y2 } = draftCalibrate;
      const len = Math.hypot(x2 - x1, y2 - y1);
      ctx.strokeStyle = "#dc2626";
      ctx.fillStyle = "#991b1b";
      ctx.lineWidth = 2 / zoom;
      ctx.setLineDash([10 / zoom, 5 / zoom]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      ctx.font = `${13 / zoom}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${len.toFixed(1)} px`, mx, my - 6 / zoom);
    }

    ctx.restore();
  }, [
    plan,
    rooms,
    elements,
    selectedId,
    draftRect,
    draftWall,
    draftCalibrate,
    pan,
    zoom,
    fpW,
    fpH,
    gridStepWorld,
    bgEpoch,
    viewport.w,
    viewport.h,
    gridMode,
    tool,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    if (tool !== "select") setSelectHover(null);
  }, [tool]);

  const drawMinimap = useCallback(() => {
    const mini = minimapRef.current;
    if (!mini || !plan) return;
    const ctx = mini.getContext("2d");
    if (!ctx) return;
    const mw = MINIMAP_W;
    const mh = MINIMAP_H;
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
    const vx = ox + wx0 * s;
    const vy = oy + wy0 * s;
    const vww = (wx1 - wx0) * s;
    const vhh = (wy1 - wy0) * s;
    ctx.fillStyle = "rgba(37, 99, 235, 0.12)";
    ctx.fillRect(vx, vy, vww, vhh);
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.strokeRect(vx, vy, vww, vhh);
  }, [plan, rooms, fpW, fpH, pan, zoom, viewport.w, viewport.h]);

  useEffect(() => {
    drawMinimap();
  }, [drawMinimap]);

  const finalizeRect = (x: number, y: number, w: number, h: number) => {
    if (w < MIN_ROOM_PX || h < MIN_ROOM_PX) return;
    const id = crypto.randomUUID();
    const meta = { ...defaultMetadata() } as Record<string, unknown>;
    const cm = cmRef.current;
    const { areaM2, widthM, heightM } = roomMeters(w, h, cm);
    meta.size_m2 = areaM2;
    meta.width_meters = widthM;
    meta.height_meters = heightM;
    commitHistory();
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
    commitHistory();
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

    const w = getCanvasPoint(e);
    const inFloor = w.x >= 0 && w.y >= 0 && w.x <= fpW && w.y <= fpH;

    if ((spaceDown || tool === "move") && e.button === 0) {
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

    if (tool === "calibrate") {
      canvas.setPointerCapture(e.pointerId);
      const cx = Math.max(0, Math.min(fpW, w.x));
      const cy = Math.max(0, Math.min(fpH, w.y));
      setDraftCalibrate({ x1: cx, y1: cy, x2: cx, y2: cy });
      return;
    }

    if (tool === "select" && selectedId) {
      const sr = rooms.find((x) => x.id === selectedId);
      if (sr && isRectLikeRoom(sr)) {
        const rh = hitTestResizeHandle(w.x, w.y, sr, zoom);
        if (rh) {
          commitHistory();
          canvas.setPointerCapture(e.pointerId);
          setResize({
            roomId: sr.id,
            handle: rh,
            startX: w.x,
            startY: w.y,
            orig: { x: sr.x, y: sr.y, width: sr.width, height: sr.height },
          });
          return;
        }
      }
    }

    if (tool === "select") {
      const hit = hitTestRoom(w.x, w.y, rooms);
      if (hit) {
        const r = rooms.find((x) => x.id === hit);
        if (r) {
          commitHistory();
          setSelectedId(hit);
          canvas.setPointerCapture(e.pointerId);
          setDrag({ roomId: hit, startX: w.x, startY: w.y, origX: r.x, origY: r.y });
        }
      } else {
        setSelectedId(null);
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (panDrag) {
      const dx = e.clientX - panDrag.startClientX;
      const dy = e.clientY - panDrag.startClientY;
      setPan({ x: panDrag.startPanX + dx, y: panDrag.startPanY + dy });
      return;
    }
    const w = getCanvasPoint(e);
    if (draftCalibrate) {
      const cx = Math.max(0, Math.min(fpW, w.x));
      const cy = Math.max(0, Math.min(fpH, w.y));
      setDraftCalibrate({ ...draftCalibrate, x2: cx, y2: cy });
      return;
    }
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
    if (resize) {
      const dx = w.x - resize.startX;
      const dy = w.y - resize.startY;
      const { x, y, width, height } = applyResizeFromDelta(
        resize.handle,
        resize.orig.x,
        resize.orig.y,
        resize.orig.width,
        resize.orig.height,
        dx,
        dy,
        fpW,
        fpH,
      );
      setRooms((prev) =>
        prev.map((r) => (r.id === resize.roomId ? { ...r, x, y, width, height } : r)),
      );
      setDirty(true);
      return;
    }
    if (drag) {
      const dx = w.x - drag.startX;
      const dy = w.y - drag.startY;
      setRooms((prev) =>
        prev.map((r) => (r.id === drag.roomId ? { ...r, x: drag.origX + dx, y: drag.origY + dy } : r)),
      );
      setDirty(true);
      return;
    }
    if (
      tool === "select" &&
      !panDrag &&
      !draftCalibrate &&
      !draftRect &&
      !draftWall
    ) {
      const sel = selectedId ? rooms.find((r) => r.id === selectedId) : null;
      if (sel && isRectLikeRoom(sel)) {
        const h = hitTestResizeHandle(w.x, w.y, sel, zoom);
        if (h) {
          setSelectHover((p) => (p === h ? p : h));
          return;
        }
      }
      if (hitTestRoom(w.x, w.y, rooms)) {
        setSelectHover((p) => (p === "move" ? p : "move"));
        return;
      }
      setSelectHover((p) => (p === null ? p : null));
    } else if (selectHover !== null) {
      setSelectHover(null);
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
    if (draftCalibrate) {
      const { x1, y1, x2, y2 } = draftCalibrate;
      const pixelLength = Math.hypot(x2 - x1, y2 - y1);
      setDraftCalibrate(null);
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (pixelLength >= 5) {
        setCalibrateMetersDraft("");
        setCalibrateDialog({ pixelLength });
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
      if (w >= MIN_ROOM_PX && h >= MIN_ROOM_PX) finalizeRect(x, y, w, h);
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
    if (resize) {
      setResize(null);
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
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
    if (tool === "calibrate") return;
    const w = getCanvasPoint(e);
    if (w.x < 0 || w.y < 0 || w.x > fpW || w.y > fpH) return;
    if (hitTestRoom(w.x, w.y, rooms)) return;
    fitToView();
  };

  const selectedRoom = useMemo(() => rooms.find((r) => r.id === selectedId) ?? null, [rooms, selectedId]);

  const updateSelected = (patch: Partial<RoomRow>) => {
    if (!selectedId) return;
    commitHistory();
    setRooms((prev) => prev.map((r) => (r.id === selectedId ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const deleteSelectedRoom = () => {
    if (!selectedId) return;
    commitHistory();
    setRooms((prev) => prev.filter((r) => r.id !== selectedId));
    setSelectedId(null);
    setDirty(true);
  };

  const zoomPct = Math.round(zoom * 100);

  const selectedDims = useMemo(() => {
    if (!selectedRoom) return null;
    return roomDimsMeters(selectedRoom, cmPerPixel);
  }, [selectedRoom, cmPerPixel]);

  useEffect(() => {
    if (!calibrateDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setCalibrateDialog(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [calibrateDialog]);

  const confirmCalibrate = () => {
    if (!calibrateDialog) return;
    const meters = parseFloat(calibrateMetersDraft.replace(",", "."));
    if (!Number.isFinite(meters) || meters <= 0) return;
    const cm = (meters * 100) / calibrateDialog.pixelLength;
    setCmPerPixel(cm);
    setDirty(true);
    setCalibrateDialog(null);
  };

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
    <main
      style={{
        maxWidth: 1600,
        margin: "0 auto",
        padding: "16px",
        width: "100%",
        boxSizing: "border-box",
        overflowX: "auto",
      }}
    >
      <div style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <Link href="/floor-plans">← Floor planner</Link>
        <h1 style={{ margin: 0, flex: "1 1 auto", fontSize: 20 }}>{plan.name}</h1>
        <button
          type="button"
          onClick={() => void save(true)}
          disabled={exportingPdf}
          style={{
            padding: "8px 16px",
            background: "#1a4a4a",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: exportingPdf ? "default" : "pointer",
            fontWeight: 600,
            opacity: exportingPdf ? 0.6 : 1,
          }}
        >
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => void exportFloorPlanPdf()}
          disabled={exportingPdf}
          style={{
            padding: "8px 16px",
            background: exportingPdf ? "#94a3b8" : "#0f766e",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: exportingPdf ? "wait" : "pointer",
            fontWeight: 600,
          }}
        >
          {exportingPdf ? "Exporting…" : "Export PDF"}
        </button>
      </div>

      {typeof detectedScale === "number" && detectedScale > 0 && !pdfScaleDetectedBannerDismissed ? (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
            padding: "10px 14px",
            background: "#ecfdf5",
            color: "#14532d",
            border: "1px solid #6ee7b7",
            borderRadius: 10,
            fontSize: 14,
          }}
        >
          <span style={{ flex: "1 1 auto", minWidth: 0 }}>
            Scale 1:{detectedScale} detected from PDF and applied automatically. You can adjust it using the Calibrate tool.
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setPdfScaleDetectedBannerDismissed(true)}
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              padding: 0,
              lineHeight: 1,
              borderRadius: 8,
              border: "1px solid #34d399",
              background: "#fff",
              cursor: "pointer",
              fontSize: 18,
              color: "#14532d",
            }}
          >
            ×
          </button>
        </div>
      ) : null}

      {detectedScale === null && !pdfScaleUnknownBannerDismissed ? (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
            padding: "10px 14px",
            background: "#fffbeb",
            color: "#92400e",
            border: "1px solid #fcd34d",
            borderRadius: 10,
            fontSize: 14,
          }}
        >
          <span style={{ flex: "1 1 auto", minWidth: 0 }}>
            Could not detect scale automatically — use the Calibrate tool in the toolbar to set the scale manually.
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setPdfScaleUnknownBannerDismissed(true)}
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              padding: 0,
              lineHeight: 1,
              borderRadius: 8,
              border: "1px solid #fbbf24",
              background: "#fff",
              cursor: "pointer",
              fontSize: 18,
              color: "#92400e",
            }}
          >
            ×
          </button>
        </div>
      ) : null}

      {error ? <p style={{ color: "#b00020", marginBottom: 8 }}>{error}</p> : null}

      {calibrateDialog ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="calibrate-dialog-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15, 23, 42, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setCalibrateDialog(null)}
        >
          <div
            style={{
              background: "#fff",
              padding: 20,
              borderRadius: 12,
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
              minWidth: 300,
              maxWidth: "100%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div id="calibrate-dialog-title" style={{ fontWeight: 600, marginBottom: 12, fontSize: 15 }}>
              Enter real-world length (meters):
            </div>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "#64748b" }}>
              Line length: {calibrateDialog.pixelLength.toFixed(1)} floor-plan pixels
            </p>
            <input
              type="number"
              min={0.001}
              step={0.01}
              value={calibrateMetersDraft}
              onChange={(e) => setCalibrateMetersDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmCalibrate();
                }
              }}
              autoFocus
              style={{
                width: "100%",
                padding: "10px 12px",
                marginBottom: 14,
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                fontSize: 16,
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setCalibrateDialog(null)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmCalibrate()}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "#1a4a4a",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
        <button type="button" onClick={() => setTool("move")} style={toolbarBtn(tool === "move")} title="Pan the view (same as Space+drag)">
          Move
        </button>
        <button type="button" onClick={() => setTool("rect")} style={toolbarBtn(tool === "rect")}>
          Draw Room
        </button>
        <button type="button" onClick={() => setTool("wall")} style={toolbarBtn(tool === "wall")}>
          Draw Wall
        </button>

        <span style={{ width: 1, height: 22, background: "#cbd5e1", margin: "0 4px" }} />

        <button
          type="button"
          onClick={() => applyUndo()}
          disabled={undoLen === 0}
          title="Undo (Ctrl+Z)"
          style={{
            ...toolbarBtn(false),
            opacity: undoLen === 0 ? 0.45 : 1,
            cursor: undoLen === 0 ? "default" : "pointer",
          }}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => applyRedo()}
          disabled={redoLen === 0}
          title="Redo (Ctrl+Shift+Z)"
          style={{
            ...toolbarBtn(false),
            opacity: redoLen === 0 ? 0.45 : 1,
            cursor: redoLen === 0 ? "default" : "pointer",
          }}
        >
          Redo
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
        <button type="button" title="100% zoom (1:1 pixels)" onClick={() => zoomTo100()} style={toolbarBtn(false)}>
          100%
        </button>
        <button type="button" title="Fit entire floor plan in view" onClick={() => fitToView()} style={toolbarBtn(false)}>
          Fit
        </button>
        <span style={{ fontSize: 13, color: "#334155", fontWeight: 600, minWidth: 52 }} title="Canvas zoom">
          {zoomPct}%
        </span>

        <span style={{ width: 1, height: 22, background: "#cbd5e1", margin: "0 4px" }} />

        <span style={{ fontWeight: 600, fontSize: 13, color: "#334155" }}>Scale</span>
        <button
          type="button"
          onClick={() => setTool("calibrate")}
          style={toolbarBtn(tool === "calibrate")}
          title="Draw a line along a known distance, then enter its real length in meters"
        >
          Calibrate
        </button>
        <span
          style={{
            fontSize: 12,
            color: "#0f172a",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
          title="Real-world distance represented by one floor-plan pixel"
        >
          1 px = {cmPerPixel.toFixed(2)} cm
        </span>

        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          Grid
          <select
            value={gridMode}
            onChange={(e) => {
              setGridMode(e.target.value as GridMode);
              setDirty(true);
            }}
            style={{ padding: "4px 8px", borderRadius: 6 }}
          >
            <option value="show">Show</option>
            <option value="hide">Hide</option>
            <option value="dots">Dots</option>
          </select>
        </label>

        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          Background opacity:
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
          <span style={{ minWidth: 42, fontVariantNumeric: "tabular-nums" }}>{Math.round(num(plan.background_opacity, 0.5) * 100)}%</span>
        </label>
      </div>

      <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b" }}>
        Scroll wheel: zoom · Middle-drag or Space+drag: pan · Double-click empty: fit · Calibrate tool: set scale from a known length
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "nowrap",
          gap: 16,
          alignItems: "flex-start",
          width: "100%",
          minWidth: 0,
        }}
      >
        <div
          ref={wrapRef}
          style={{
            flex: "1 1 0%",
            minWidth: 0,
            position: "relative",
          }}
        >
          <canvas
            ref={canvasRef}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setSelectHover(null)}
            onDoubleClick={onDoubleClick}
            onAuxClick={(e) => e.button === 1 && e.preventDefault()}
            style={{
              display: "block",
              maxWidth: "100%",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              cursor:
                (tool === "move" || spaceDown) && panDrag
                  ? "grabbing"
                  : tool === "move" || spaceDown
                    ? "grab"
                    : resize
                      ? cursorForResizeHandle(resize.handle)
                      : drag
                        ? "grabbing"
                        : tool === "rect" || tool === "wall" || tool === "calibrate"
                          ? "crosshair"
                          : tool === "select"
                            ? selectHover === "move"
                              ? "move"
                              : selectHover
                                ? cursorForResizeHandle(selectHover)
                                : "default"
                            : "default",
              touchAction: "none",
              outline: "none",
            }}
          />
          <canvas
            ref={minimapRef}
            width={MINIMAP_W}
            height={MINIMAP_H}
            onPointerDown={onMinimapPointerDown}
            onPointerMove={onMinimapPointerMove}
            onPointerUp={endMinimapDrag}
            onPointerCancel={endMinimapDrag}
            onLostPointerCapture={() => {
              minimapDragRef.current.active = false;
              minimapDragRef.current.pointerId = -1;
              setMinimapDragging(false);
            }}
            title="Minimap — drag to pan the main view"
            style={{
              position: "absolute",
              left: 8,
              bottom: 8,
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              background: "#fff",
              pointerEvents: "auto",
              cursor: minimapDragging ? "grabbing" : "grab",
              touchAction: "none",
            }}
          />
        </div>

        <aside
          style={{
            flex: "0 0 300px",
            width: 300,
            minWidth: 260,
            maxWidth: 300,
            boxSizing: "border-box",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 14,
            fontSize: 14,
            alignSelf: "stretch",
          }}
        >
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
                    const rtNew = (FLOOR_PLAN_ROOM_TYPES as readonly string[]).includes(t) ? (t as FloorPlanRoomType) : "other";
                    const rtOld = (FLOOR_PLAN_ROOM_TYPES as readonly string[]).includes(selectedRoom.room_type)
                      ? (selectedRoom.room_type as FloorPlanRoomType)
                      : "other";
                    const oldDefault = ROOM_TYPE_COLORS[rtOld].fill;
                    const newDefault = ROOM_TYPE_COLORS[rtNew].fill;
                    const cur = selectedRoom.color;
                    const useTypeFill = !cur || cur === oldDefault;
                    updateSelected({ room_type: t, ...(useTypeFill ? { color: newDefault } : {}) });
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
              <div style={{ fontWeight: 600, fontSize: 15 }}>Size: {selectedDims.areaM2.toFixed(1)} m²</div>
              <div style={{ fontSize: 13, color: "#374151" }}>
                Width: {selectedDims.widthM.toFixed(1)}m × Height: {selectedDims.heightM.toFixed(1)}m
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
