"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
} from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { createRoomPhotoSignedUrlMap } from "@/lib/storage/room-photo-signed-url";
import * as XLSX from "xlsx";
import {
  AMENITY_KEYS,
  SPACE_TYPES,
  type SpaceType,
  roomStatusBadgeStyle,
  spaceTypeBadgeStyle,
  spaceTypeLabel,
} from "@/lib/rooms/labels";
import { loadScopedPropertiesForUser } from "@/lib/properties/scoped";

type RoomPhoto = { id: string; storage_path: string; sort_order: number };

type RoomRow = {
  id: string;
  property_id: string;
  name: string;
  room_number: string | null;
  floor: string | null;
  space_type: string;
  capacity: number;
  size_m2: number | null;
  space_status: string;
  hourly_price: number;
  requires_approval: boolean;
  combination_id: string | null;
  is_combination_parent: boolean;
  hide_tenant_in_ui: boolean | null;
  monthly_rent_eur: number | null;
  tenant_company_name: string | null;
  tenant_contact_name: string | null;
  tenant_contact_email: string | null;
  tenant_contact_phone: string | null;
  contract_start: string | null;
  contract_end: string | null;
  security_deposit_eur: number | null;
  half_day_price_eur: number | null;
  full_day_price_eur: number | null;
  min_booking_hours: number | null;
  daily_price_eur: number | null;
  amenity_projector: boolean | null;
  amenity_whiteboard: boolean | null;
  amenity_video_conferencing: boolean | null;
  amenity_kitchen_access: boolean | null;
  amenity_parking: boolean | null;
  amenity_natural_light: boolean | null;
  amenity_air_conditioning: boolean | null;
  amenity_standing_desk: boolean | null;
  amenity_phone_booth: boolean | null;
  amenity_reception_service: boolean | null;
  room_photos: RoomPhoto[] | null;
};

type PropertyRow = { id: string; name: string; city: string | null; tenant_id: string };
type MembershipRow = { tenant_id: string | null; role: string | null };

function priceForFilter(r: RoomRow): number {
  if (r.space_type === "office") return Number(r.monthly_rent_eur) || 0;
  if (r.space_type === "hot_desk") {
    return Math.max(Number(r.hourly_price) || 0, Number(r.daily_price_eur) || 0);
  }
  return Math.max(
    Number(r.hourly_price) || 0,
    Number(r.half_day_price_eur) || 0,
    Number(r.full_day_price_eur) || 0
  );
}

function formatSpaceStatusLabel(s: string): string {
  return (s ?? "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function isVisibleRoom(r: RoomRow): boolean {
  return r.space_status !== "merged" || r.is_combination_parent;
}

function tenantIdForProperty(properties: PropertyRow[], propertyId: string): string | null {
  return properties.find((p) => p.id === propertyId)?.tenant_id ?? null;
}

function canManageRoom(
  room: RoomRow,
  properties: PropertyRow[],
  memberships: MembershipRow[],
  isSuper: boolean
): boolean {
  if (isSuper) return true;
  const tid = tenantIdForProperty(properties, room.property_id);
  if (!tid) return false;
  return memberships.some(
    (m) =>
      m.tenant_id === tid && ["owner", "manager"].includes((m.role ?? "").toLowerCase())
  );
}

function isPropertyOwner(
  propertyId: string,
  properties: PropertyRow[],
  memberships: MembershipRow[],
  isSuper: boolean
): boolean {
  if (isSuper) return true;
  const tid = tenantIdForProperty(properties, propertyId);
  if (!tid) return false;
  return memberships.some((m) => m.tenant_id === tid && (m.role ?? "").toLowerCase() === "owner");
}

function canSeeTenantDetails(
  room: RoomRow,
  properties: PropertyRow[],
  memberships: MembershipRow[],
  isSuper: boolean
): boolean {
  if (room.space_type !== "office") return false;
  if (isSuper) return true;
  const tid = tenantIdForProperty(properties, room.property_id);
  if (!tid) return false;
  if (memberships.some((m) => m.tenant_id === tid && (m.role ?? "").toLowerCase() === "owner")) {
    return true;
  }
  const isManager = memberships.some(
    (m) => m.tenant_id === tid && (m.role ?? "").toLowerCase() === "manager"
  );
  if (isManager && !room.hide_tenant_in_ui) return true;
  return false;
}

function occupancyForRooms(rooms: RoomRow[]): { pct: number; occ: number; total: number } {
  const list = rooms.filter(isVisibleRoom);
  if (list.length === 0) return { pct: 0, occ: 0, total: 0 };
  const occ = list.filter((r) => r.space_status === "occupied").length;
  return { occ, total: list.length, pct: Math.round((occ / list.length) * 1000) / 10 };
}

const btn: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #ccc",
  background: "#fff",
  cursor: "pointer",
  fontSize: 13,
};

const btnPrimary: CSSProperties = { ...btn, background: "#111", color: "#fff", borderColor: "#111" };

function statusDotColor(status: string): string {
  switch (status) {
    case "available":
      return "#1b5e20"; // green
    case "occupied":
      return "#e65100"; // amber/orange
    case "under_maintenance":
      return "#b00020"; // red
    case "reserved":
      return "#1565c0"; // blue (CRM hold)
    default:
      return "#999";
  }
}

function StatusDropdown({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (next: "available" | "occupied" | "under_maintenance" | "reserved") => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const options: Array<{ value: "available" | "occupied" | "under_maintenance" | "reserved"; label: string }> = [
    { value: "available", label: "Available" },
    { value: "reserved", label: "Reserved" },
    { value: "occupied", label: "Occupied" },
    { value: "under_maintenance", label: "Under maintenance" },
  ];

  const selectedLabel = options.find((o) => o.value === value)?.label ?? formatSpaceStatusLabel(value);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        style={{
          ...btn,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: statusDotColor(value),
            display: "inline-block",
          }}
        />
        {selectedLabel}
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 20,
            minWidth: 220,
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
            padding: 6,
          }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 10,
                border: "none",
                background: o.value === value ? "#f1f3f5" : "transparent",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
                font: "inherit",
              }}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: statusDotColor(o.value),
                  display: "inline-block",
                }}
              />
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const IMPORT_COLUMNS = [
  "tenant_name",
  "property_name",
  "room_name",
  "space_type",
  "floor",
  "room_number",
  "capacity",
  "size_m2",
  "hourly_price",
  "monthly_rent",
  "requires_approval",
  "space_status",
  "amenities",
  "notes",
] as const;

const IMPORT_SPACE_TYPES = [...SPACE_TYPES];
const IMPORT_SPACE_STATUS_VALUES = ["available", "occupied", "under_maintenance"] as const;

function normalizeHeaderCell(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

function toMaybeNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseYesNoClient(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (!s) return null;
    if (["yes", "y", "true", "1"].includes(s)) return true;
    if (["no", "n", "false", "0"].includes(s)) return false;
  }
  return null;
}

function parseSpaceStatusClient(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const norm = s.toLowerCase();
  if (!IMPORT_SPACE_STATUS_VALUES.includes(norm as (typeof IMPORT_SPACE_STATUS_VALUES)[number])) return null;
  return norm;
}

export default function RoomsDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  /** Always one of the user's (or all, for super_admin) properties — stats and list are scoped to this. */
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");

  const [filterType, setFilterType] = useState<string>("");
  const [filterFloor, setFilterFloor] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterSizeMin, setFilterSizeMin] = useState<string>("");
  const [filterSizeMax, setFilterSizeMax] = useState<string>("");
  const [filterPriceMin, setFilterPriceMin] = useState<string>("");
  const [filterPriceMax, setFilterPriceMax] = useState<string>("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mergeName, setMergeName] = useState("");
  const [mergeType, setMergeType] = useState<SpaceType>("venue");
  const [mergeBusy, setMergeBusy] = useState(false);

  const [editing, setEditing] = useState<RoomRow | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [signedRoomPhotoUrls, setSignedRoomPhotoUrls] = useState<Map<string, string>>(new Map());

  // Excel import/export
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importPreviewRows, setImportPreviewRows] = useState<
    Array<{
      rowNumber: number;
      normalized: {
        rowNumber: number;
        tenant_name: string;
        property_name: string;
        room_name: string;
        space_type: string;
        floor?: string | null;
        room_number?: string | null;
        capacity?: number | null;
        size_m2?: number | null;
        hourly_price?: number | null;
        monthly_rent?: number | null;
        requires_approval?: boolean | null;
        space_status?: string | null;
        amenities?: string | null;
        notes?: string | null;
      };
      errors: string[];
    }>
  >([]);
  const [importResults, setImportResults] = useState<
    Array<{
      rowNumber: number;
      ok: boolean;
      action: "insert" | "update" | "skip";
      room_id?: string;
      error?: string;
    }>
  >([]);
  const [showImportModal, setShowImportModal] = useState(false);

  const loadAll = useCallback(async () => {
    const supabase = getSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }

    const { data: mem, error: mErr } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id);
    if (mErr) throw new Error(mErr.message);
    const mrows = (mem ?? []) as MembershipRow[];
    setMemberships(mrows);
    const scoped = await loadScopedPropertiesForUser(supabase, user.id);
    const superA = scoped.isSuperAdmin;
    setIsSuperAdmin(superA);
    const plist = (scoped.properties as PropertyRow[]) ?? [];
    setProperties(plist);
    const pids = plist.map((p) => p.id);
    if (pids.length === 0) {
      setRooms([]);
      setSelectedPropertyId("");
      return;
    }

    // Load spaces without embedding room_photos: if room_photos is missing or PostgREST
    // has no FK in the schema cache, nested selects fail the whole request and no rooms load.
    const { data: spaces, error: sErr } = await supabase
      .from("bookable_spaces")
      .select("*")
      .in("property_id", pids)
      .order("name", { ascending: true });

    if (sErr) throw new Error(sErr.message);

    const list = (spaces as RoomRow[]) ?? [];
    const spaceIds = list.map((r) => r.id);

    const photosBySpace = new Map<string, RoomPhoto[]>();
    if (spaceIds.length > 0) {
      const { data: photos, error: phErr } = await supabase
        .from("room_photos")
        .select("id, space_id, storage_path, sort_order")
        .in("space_id", spaceIds)
        .order("sort_order", { ascending: true });
      if (!phErr && photos?.length) {
        for (const ph of photos as (RoomPhoto & { space_id: string })[]) {
          const row: RoomPhoto = {
            id: ph.id,
            storage_path: ph.storage_path,
            sort_order: ph.sort_order,
          };
          const acc = photosBySpace.get(ph.space_id) ?? [];
          acc.push(row);
          photosBySpace.set(ph.space_id, acc);
        }
        for (const arr of photosBySpace.values()) {
          arr.sort((a, b) => a.sort_order - b.sort_order);
        }
      }
    }

    const merged = list.map((r) => ({
      ...r,
      room_photos: photosBySpace.get(r.id) ?? [],
    }));

    setRooms(merged);
    setSelectedPropertyId((prev) => (prev && pids.includes(prev) ? prev : pids[0]!));
  }, [router]);

  const downloadTemplate = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/rooms/template", { method: "GET" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? "Template download failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "rooms_import_template.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Template download failed");
    }
  }, []);

  const parseExcelFileToRows = useCallback(async (file: File) => {
    const buf = await file.arrayBuffer();
    const workbook = XLSX.read(buf, { type: "array" });

    const expectedHeaders = new Set<string>(IMPORT_COLUMNS as unknown as string[]);
    const preview: typeof importPreviewRows = [];

    const spaceTypeSet = new Set<string>(IMPORT_SPACE_TYPES as unknown as string[]);
    const roomTypeFromSheet = (sheetName: string): string | null => {
      const s = sheetName.trim();
      return spaceTypeSet.has(s) ? s : null;
    };

    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      if (!ws) continue;

      const inferredType = roomTypeFromSheet(sheetName);
      // We only import from our known sheets (still allow space_type column override).
      if (!inferredType) continue;

      const rows2d = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
      if (!rows2d.length) continue;

      // Find header row: first row that contains both property_name and room_name.
      let headerRowIndex = -1;
      let headerCells: string[] = [];
      for (let i = 0; i < Math.min(rows2d.length, 30); i++) {
        const row = rows2d[i] ?? [];
        const normalized = row.map((c) => normalizeHeaderCell(c));
        const hasProperty = normalized.includes("property_name");
        const hasRoom = normalized.includes("room_name");
        if (hasProperty && hasRoom) {
          headerRowIndex = i;
          headerCells = row.map((c) => String(c ?? "").trim());
          break;
        }
      }
      if (headerRowIndex === -1) continue;

      const headerToIndex: Record<string, number> = {};
      for (let c = 0; c < headerCells.length; c++) {
        const keyNorm = normalizeHeaderCell(headerCells[c]);
        if (expectedHeaders.has(keyNorm)) headerToIndex[keyNorm] = c;
      }

      const getCell = (r: number, key: string): unknown => {
        const idx = headerToIndex[key];
        if (idx == null) return "";
        return rows2d[r]?.[idx];
      };

      for (let r = headerRowIndex + 1; r < rows2d.length; r++) {
        const roomNameRaw = getCell(r, "room_name");
        const propertyNameRaw = getCell(r, "property_name");
        const tenantNameRaw = getCell(r, "tenant_name");
        const roomName = String(roomNameRaw ?? "").trim();
        const propertyName = String(propertyNameRaw ?? "").trim();
        const tenantName = String(tenantNameRaw ?? "").trim();

        // Skip empty lines
        if (!propertyName && !roomName && !tenantName) continue;

        const spaceTypeRaw = String(getCell(r, "space_type") ?? "").trim() || inferredType;
        const capacity = toMaybeNumber(getCell(r, "capacity"));
        const sizeM2 = toMaybeNumber(getCell(r, "size_m2"));
        const hourlyPrice = toMaybeNumber(getCell(r, "hourly_price"));
        const monthlyRent = toMaybeNumber(getCell(r, "monthly_rent"));
        const requiresApproval = parseYesNoClient(getCell(r, "requires_approval"));
        const spaceStatus = parseSpaceStatusClient(getCell(r, "space_status"));
        const amenitiesRaw = String(getCell(r, "amenities") ?? "").trim() || null;
        const notes = String(getCell(r, "notes") ?? "").trim() || null;

        const errors: string[] = [];
        if (!propertyName) errors.push("Missing property_name");
        if (!roomName) errors.push("Missing room_name");
        if (!tenantName) errors.push("Missing tenant_name");
        if (!spaceTypeSet.has(spaceTypeRaw)) errors.push(`Invalid space_type: ${spaceTypeRaw}`);
        if (capacity == null || capacity < 1) errors.push("capacity must be >= 1");
        if (!spaceStatus) errors.push("space_status must be available/occupied/under_maintenance");
        if (requiresApproval == null) errors.push("requires_approval must be yes/no");

        if (spaceTypeRaw === "office") {
          if (monthlyRent == null || monthlyRent < 0) errors.push("monthly_rent must be >= 0 for office");
        } else {
          if (hourlyPrice == null || hourlyPrice < 0) errors.push("hourly_price must be >= 0 for non-office rooms");
        }

        const normalized = {
          rowNumber: r + 1, // Excel rows are 1-indexed
          tenant_name: tenantName,
          property_name: propertyName,
          room_name: roomName,
          space_type: spaceTypeRaw,
          floor: String(getCell(r, "floor") ?? "").trim() || null,
          room_number: String(getCell(r, "room_number") ?? "").trim() || null,
          capacity,
          size_m2: sizeM2,
          hourly_price: hourlyPrice,
          monthly_rent: monthlyRent,
          requires_approval: requiresApproval,
          space_status: spaceStatus,
          amenities: amenitiesRaw,
          notes,
        };

        preview.push({ rowNumber: r + 1, normalized, errors });
      }
    }

    return preview;
  }, []);

  const onPickImportFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    setImportBusy(true);
    setImportResults([]);
    setImportPreviewRows([]);
    setShowImportModal(false);
    setError(null);

    try {
      const parsed = await parseExcelFileToRows(file);
      if (parsed.length === 0) {
        setError("No rows found to import in the uploaded Excel file.");
        return;
      }
      setImportPreviewRows(parsed);
      setShowImportModal(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read Excel file");
    } finally {
      setImportBusy(false);
      ev.target.value = "";
    }
  };

  const confirmImport = async () => {
    if (!importPreviewRows.length) return;
    setImportBusy(true);
    setError(null);
    setImportResults([]);
    try {
      const payload = {
        rows: importPreviewRows.map((r) => r.normalized),
      };
      const res = await fetch("/api/rooms/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { ok?: boolean; results?: any[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Import failed");

      const results = (json.results ?? []) as Array<{
        rowNumber: number;
        ok: boolean;
        action: "insert" | "update" | "skip";
        room_id?: string;
        error?: string;
      }>;
      setImportResults(results);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImportBusy(false);
    }
  };

  useEffect(() => {
    let c = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadAll();
      } catch (e) {
        if (!c) setError(e instanceof Error ? e.message : "Failed to load");
      }
      if (!c) setLoading(false);
    })();
    return () => {
      c = true;
    };
  }, [loadAll]);

  useEffect(() => {
    const q = (searchParams.get("propertyId") ?? "").trim();
    if (!q || properties.length === 0) return;
    if (properties.some((p) => p.id === q)) setSelectedPropertyId(q);
  }, [searchParams, properties]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const paths: string[] = [];
      for (const r of rooms) {
        for (const ph of r.room_photos ?? []) paths.push(ph.storage_path);
      }
      if (editing) {
        for (const ph of editing.room_photos ?? []) paths.push(ph.storage_path);
      }
      const supabase = getSupabaseClient();
      const map = await createRoomPhotoSignedUrlMap(supabase, paths);
      if (!cancelled) setSignedRoomPhotoUrls(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [rooms, editing]);

  const propertyQuickStats = useMemo(() => {
    const m: Record<string, { totalRooms: number; occPct: number }> = {};
    for (const p of properties) {
      const list = rooms.filter((r) => r.property_id === p.id).filter(isVisibleRoom);
      const { pct } = occupancyForRooms(list);
      m[p.id] = { totalRooms: list.length, occPct: pct };
    }
    return m;
  }, [rooms, properties]);

  const scopedRooms = useMemo(() => {
    if (!selectedPropertyId) return [];
    return rooms.filter((r) => r.property_id === selectedPropertyId);
  }, [rooms, selectedPropertyId]);

  const floors = useMemo(() => {
    const s = new Set<string>();
    scopedRooms.forEach((r) => {
      if (r.floor) s.add(r.floor);
    });
    return [...s].sort();
  }, [scopedRooms]);

  const filteredRooms = useMemo(() => {
    return scopedRooms.filter((r) => {
      if (!isVisibleRoom(r)) return false;
      if (filterType && r.space_type !== filterType) return false;
      if (filterFloor && (r.floor ?? "") !== filterFloor) return false;
      if (filterStatus && r.space_status !== filterStatus) return false;
      const sz = Number(r.size_m2) || 0;
      if (filterSizeMin && sz < Number(filterSizeMin)) return false;
      if (filterSizeMax && sz > Number(filterSizeMax)) return false;
      const pr = priceForFilter(r);
      if (filterPriceMin && pr < Number(filterPriceMin)) return false;
      if (filterPriceMax && pr > Number(filterPriceMax)) return false;
      return true;
    });
  }, [scopedRooms, filterType, filterFloor, filterStatus, filterSizeMin, filterSizeMax, filterPriceMin, filterPriceMax]);

  const summaryRooms = useMemo(
    () => scopedRooms.filter(isVisibleRoom),
    [scopedRooms]
  );

  const countsByType = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of SPACE_TYPES) m[t] = 0;
    for (const r of summaryRooms) {
      m[r.space_type] = (m[r.space_type] ?? 0) + 1;
    }
    return m;
  }, [summaryRooms]);

  const occupancyByType = useMemo(() => {
    const m: Record<string, ReturnType<typeof occupancyForRooms>> = {};
    for (const t of SPACE_TYPES) {
      m[t] = occupancyForRooms(summaryRooms.filter((r) => r.space_type === t));
    }
    return m;
  }, [summaryRooms]);

  const overallOcc = useMemo(() => occupancyForRooms(summaryRooms), [summaryRooms]);

  const monthlyOfficeRevenue = useMemo(() => {
    return summaryRooms
      .filter((r) => r.space_type === "office" && r.space_status === "occupied")
      .reduce((s, r) => s + (Number(r.monthly_rent_eur) || 0), 0);
  }, [summaryRooms]);

  const occupancyByFloor = useMemo(() => {
    const floors = [...new Set(summaryRooms.map((r) => r.floor ?? "—"))].sort();
    return floors.map((f) => ({
      floor: f,
      ...occupancyForRooms(summaryRooms.filter((r) => (r.floor ?? "—") === f)),
    }));
  }, [summaryRooms]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runMerge = async () => {
    const ids = [...selectedIds];
    if (ids.length < 2 || !mergeName.trim()) return;
    setMergeBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberSpaceIds: ids,
          displayName: mergeName.trim(),
          spaceType: mergeType,
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Merge failed");
      setSelectedIds(new Set());
      setMergeName("");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merge failed");
    } finally {
      setMergeBusy(false);
    }
  };

  const runSeparate = async (combinedSpaceId: string) => {
    if (!confirm("Separate this combined room and restore the original spaces?")) return;
    setError(null);
    try {
      const res = await fetch("/api/rooms/separate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ combinedSpaceId }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Separate failed");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Separate failed");
    }
  };

  const setRoomStatus = async (r: RoomRow, next: "available" | "occupied" | "under_maintenance" | "reserved") => {
    if (!canManageRoom(r, properties, memberships, isSuperAdmin)) return;
    const supabase = getSupabaseClient();
    const { error: uErr } = await supabase
      .from("bookable_spaces")
      .update({ space_status: next })
      .eq("id", r.id);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    await loadAll();
  };

  const openEdit = (r: RoomRow) => setEditing({ ...r, room_photos: r.room_photos ?? [] });

  const saveEdit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!editing) return;
    setEditBusy(true);
    setError(null);
    const supabase = getSupabaseClient();
    const e = editing;
    const patch: Record<string, unknown> = {
      name: e.name,
      room_number: e.room_number || null,
      floor: e.floor || null,
      space_type: e.space_type,
      capacity: e.capacity,
      size_m2: e.size_m2 === null || e.size_m2 === ("" as unknown as null) ? null : Number(e.size_m2),
      space_status: e.space_status,
      hourly_price: Number(e.hourly_price) || 0,
      requires_approval: e.requires_approval,
      hide_tenant_in_ui: !!e.hide_tenant_in_ui,
      monthly_rent_eur: e.monthly_rent_eur === null ? null : Number(e.monthly_rent_eur) || null,
      tenant_company_name: e.tenant_company_name || null,
      tenant_contact_name: e.tenant_contact_name || null,
      tenant_contact_email: e.tenant_contact_email || null,
      tenant_contact_phone: e.tenant_contact_phone || null,
      contract_start: e.contract_start || null,
      contract_end: e.contract_end || null,
      security_deposit_eur:
        e.security_deposit_eur === null ? null : Number(e.security_deposit_eur) || null,
      half_day_price_eur: e.half_day_price_eur === null ? null : Number(e.half_day_price_eur) || null,
      full_day_price_eur: e.full_day_price_eur === null ? null : Number(e.full_day_price_eur) || null,
      min_booking_hours: e.min_booking_hours === null ? null : Number(e.min_booking_hours) || null,
      daily_price_eur: e.daily_price_eur === null ? null : Number(e.daily_price_eur) || null,
    };
    for (const a of AMENITY_KEYS) {
      patch[a.key] = !!(e as unknown as Record<string, boolean>)[a.key];
    }
    const { error: uErr } = await supabase.from("bookable_spaces").update(patch).eq("id", e.id);
    setEditBusy(false);
    if (uErr) {
      setError(uErr.message);
      return;
    }
    setEditing(null);
    await loadAll();
  };

  const onPhotoPick = async (ev: ChangeEvent<HTMLInputElement>) => {
    if (!editing) return;
    const files = ev.target.files;
    if (!files?.length) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const existing = editing.room_photos ?? [];
      let order = existing.reduce((m, p) => Math.max(m, p.sort_order), -1) + 1;
      for (const file of Array.from(files)) {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${editing.property_id}/${editing.id}/${Date.now()}_${safe}`;
        const { error: upErr } = await supabase.storage.from("room-photos").upload(path, file);
        if (upErr) throw new Error(upErr.message);
        const { error: insErr } = await supabase
          .from("room_photos")
          .insert({ space_id: editing.id, storage_path: path, sort_order: order++ });
        if (insErr) throw new Error(insErr.message);
      }
      const { data: fresh } = await supabase
        .from("room_photos")
        .select("id, storage_path, sort_order")
        .eq("space_id", editing.id)
        .order("sort_order");
      setEditing({ ...editing, room_photos: (fresh as RoomPhoto[]) ?? [] });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPhotoBusy(false);
      ev.target.value = "";
    }
  };

  const deletePhoto = async (photo: RoomPhoto) => {
    if (!editing) return;
    const supabase = getSupabaseClient();
    await supabase.storage.from("room-photos").remove([photo.storage_path]);
    await supabase.from("room_photos").delete().eq("id", photo.id);
    setEditing({
      ...editing,
      room_photos: (editing.room_photos ?? []).filter((p) => p.id !== photo.id),
    });
    await loadAll();
  };

  if (loading) return <p>Loading rooms…</p>;

  if (properties.length === 0) {
    return (
      <div style={{ paddingBottom: 48 }}>
        <h1 className="vw-admin-page-title" style={{ margin: "0 0 8px" }}>Rooms management</h1>
        <p style={{ color: "#666" }}>
          You do not have access to any properties yet, or your account is not linked to a tenant with buildings.
        </p>
      </div>
    );
  }

  const selectedProperty = properties.find((p) => p.id === selectedPropertyId);

  const mergeCandidates = filteredRooms.filter(
    (r) =>
      r.space_status === "available" &&
      !r.is_combination_parent &&
      selectedIds.has(r.id) &&
      canManageRoom(r, properties, memberships, isSuperAdmin)
  );
  const mergeSameProperty =
    mergeCandidates.length === selectedIds.size &&
    mergeCandidates.length >= 2 &&
    new Set(mergeCandidates.map((r) => r.property_id)).size === 1;

  return (
    <div style={{ paddingBottom: 48 }}>
      <h1 className="vw-admin-page-title" style={{ margin: "0 0 8px" }}>Rooms management</h1>
      <p style={{ marginTop: 0, color: "#555", maxWidth: 720 }}>
        Choose a property to view rooms, stats, and reporting. Everything below is for the selected building only.
      </p>

      {error ? (
        <p style={{ color: "#b00020", padding: "8px 12px", background: "#fff5f5", borderRadius: 8 }}>{error}</p>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 16 }}>
        <button type="button" style={btnPrimary} onClick={() => void downloadTemplate()} disabled={importBusy}>
          Download template
        </button>
        <button
          type="button"
          style={btn}
          onClick={() => importFileRef.current?.click()}
          disabled={importBusy}
        >
          {importBusy ? "Importing…" : "Import from Excel"}
        </button>
        <input
          ref={importFileRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={onPickImportFile}
        />
        <span style={{ fontSize: 13, color: "#666" }}>
          Tip: Template is per room type in tabs.
        </span>
      </div>

      <section style={{ marginTop: 20 }} aria-label="Select property">
        <h2 style={{ fontSize: 15, margin: "0 0 10px", fontWeight: 600 }}>
          Property{isSuperAdmin ? " (all tenants)" : ""}
        </h2>
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            paddingBottom: 6,
            scrollbarGutter: "stable",
          }}
        >
          {properties.map((p) => {
            const sel = p.id === selectedPropertyId;
            const qs = propertyQuickStats[p.id] ?? { totalRooms: 0, occPct: 0 };
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={sel}
                onClick={() => setSelectedPropertyId(p.id)}
                style={{
                  flex: "0 0 auto",
                  minWidth: 232,
                  maxWidth: 280,
                  textAlign: "left",
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: sel ? "2px solid #111" : "1px solid #dee2e6",
                  background: sel ? "#f1f3f5" : "#fff",
                  boxShadow: sel ? "0 2px 8px rgba(0,0,0,0.08)" : "none",
                  cursor: "pointer",
                  font: "inherit",
                  color: "inherit",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.3 }}>{p.name}</div>
                <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>{p.city?.trim() ? p.city : "—"}</div>
                <div style={{ fontSize: 13, color: "#333", marginTop: 10 }}>
                  <strong>{qs.totalRooms}</strong> rooms · <strong>{qs.occPct}%</strong> occupancy
                </div>
              </button>
            );
          })}
        </div>
        {selectedProperty ? (
          <p style={{ margin: "12px 0 0", fontSize: 13, color: "#666" }}>
            Showing data for <strong>{selectedProperty.name}</strong>
            {selectedProperty.city ? ` · ${selectedProperty.city}` : ""}.{" "}
            <Link
              href={`/properties/${encodeURIComponent(selectedProperty.id)}`}
              style={{ marginLeft: 8, whiteSpace: "nowrap" }}
            >
              Property &amp; costs →
            </Link>
            <Link
              href={`/reports/rent-roll?propertyId=${encodeURIComponent(selectedProperty.id)}`}
              style={{ marginLeft: 8, whiteSpace: "nowrap" }}
            >
              Reports →
            </Link>
          </p>
        ) : null}
      </section>

      <section
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginTop: 20,
          padding: 14,
          background: "#f8f9fa",
          borderRadius: 12,
          border: "1px solid #e9ecef",
        }}
      >
        <strong style={{ width: "100%", marginBottom: 4 }}>Summary</strong>
        {SPACE_TYPES.map((t) => (
          <div key={t} style={{ padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid #dee2e6" }}>
            <div style={{ fontSize: 12, color: "#666" }}>{spaceTypeLabel(t)}</div>
            <div style={{ fontWeight: 600 }}>
              {countsByType[t] ?? 0} rooms · {occupancyByType[t]?.pct ?? 0}% occ.
            </div>
          </div>
        ))}
        <div style={{ padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid #dee2e6" }}>
          <div style={{ fontSize: 12, color: "#666" }}>Overall</div>
          <div style={{ fontWeight: 600 }}>
            {overallOcc.occ}/{overallOcc.total} occupied ({overallOcc.pct}%)
          </div>
        </div>
        <div style={{ padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid #dee2e6" }}>
          <div style={{ fontSize: 12, color: "#666" }}>Monthly office rent (occupied)</div>
          <div style={{ fontWeight: 600 }}>€{Math.round(monthlyOfficeRevenue).toString()}</div>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Occupancy reporting</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: "#555", marginBottom: 6 }}>By room type</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                  <th style={{ padding: "6px 4px" }}>Type</th>
                  <th style={{ padding: "6px 4px" }}>Occ %</th>
                  <th style={{ padding: "6px 4px" }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {SPACE_TYPES.map((t) => (
                  <tr key={t} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "6px 4px" }}>{spaceTypeLabel(t)}</td>
                    <td style={{ padding: "6px 4px" }}>{occupancyByType[t]?.pct ?? 0}%</td>
                    <td style={{ padding: "6px 4px" }}>
                      {occupancyByType[t]?.occ ?? 0}/{occupancyByType[t]?.total ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div style={{ fontSize: 13, color: "#555", marginBottom: 6 }}>By floor</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                  <th style={{ padding: "6px 4px" }}>Floor</th>
                  <th style={{ padding: "6px 4px" }}>Occ %</th>
                  <th style={{ padding: "6px 4px" }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {occupancyByFloor.map((row) => (
                  <tr key={row.floor} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "6px 4px" }}>{row.floor}</td>
                    <td style={{ padding: "6px 4px" }}>{row.pct}%</td>
                    <td style={{ padding: "6px 4px" }}>
                      {row.occ}/{row.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 24, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#555" }}>Type</span>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              style={{ padding: 8, minWidth: 140 }}
            >
              <option value="">Any</option>
              {SPACE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {spaceTypeLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#555" }}>Floor</span>
            <select
              value={filterFloor}
              onChange={(e) => setFilterFloor(e.target.value)}
              style={{ padding: 8, minWidth: 120 }}
            >
              <option value="">Any</option>
              {floors.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#555" }}>Status</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: 8, minWidth: 140 }}
            >
              <option value="">Any</option>
              <option value="available">Available</option>
              <option value="reserved">Reserved</option>
              <option value="occupied">Occupied</option>
              <option value="under_maintenance">Under maintenance</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#555" }}>Size min (m²)</span>
            <input
              value={filterSizeMin}
              onChange={(e) => setFilterSizeMin(e.target.value)}
              type="number"
              min={0}
              style={{ padding: 8, width: 100 }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#555" }}>Size max</span>
            <input
              value={filterSizeMax}
              onChange={(e) => setFilterSizeMax(e.target.value)}
              type="number"
              min={0}
              style={{ padding: 8, width: 100 }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#555" }}>Price min (€)</span>
            <input
              value={filterPriceMin}
              onChange={(e) => setFilterPriceMin(e.target.value)}
              type="number"
              min={0}
              style={{ padding: 8, width: 100 }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#555" }}>Price max</span>
            <input
              value={filterPriceMax}
              onChange={(e) => setFilterPriceMax(e.target.value)}
              type="number"
              min={0}
              style={{ padding: 8, width: 100 }}
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              style={viewMode === "grid" ? btnPrimary : btn}
              onClick={() => setViewMode("grid")}
            >
              Grid
            </button>
            <button
              type="button"
              style={viewMode === "list" ? btnPrimary : btn}
              onClick={() => setViewMode("list")}
            >
              List
            </button>
          </div>
        </div>

        {selectedIds.size > 0 ? (
          <div
            style={{
              padding: 12,
              border: "1px dashed #999",
              borderRadius: 10,
              background: "#fffef7",
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 14 }}>{selectedIds.size} selected</span>
            <input
              placeholder="Combined space name"
              value={mergeName}
              onChange={(e) => setMergeName(e.target.value)}
              style={{ padding: 8, minWidth: 200 }}
            />
            <select value={mergeType} onChange={(e) => setMergeType(e.target.value as SpaceType)} style={{ padding: 8 }}>
              {SPACE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {spaceTypeLabel(t)}
                </option>
              ))}
            </select>
            <button
              type="button"
              style={btnPrimary}
              disabled={mergeBusy || !mergeSameProperty || !mergeName.trim()}
              onClick={() => void runMerge()}
            >
              {mergeBusy ? "Merging…" : "Merge rooms"}
            </button>
            {!mergeSameProperty && selectedIds.size >= 2 ? (
              <span style={{ fontSize: 12, color: "#a00" }}>
                Select only available, non-combined rooms from one property.
              </span>
            ) : null}
            <button type="button" style={btn} onClick={() => setSelectedIds(new Set())}>
              Clear selection
            </button>
          </div>
        ) : null}
      </section>

      {viewMode === "grid" ? (
        <div
          style={{
            marginTop: 20,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {filteredRooms.map((r) => (
            <RoomCard
              key={r.id}
              room={r}
              properties={properties}
              memberships={memberships}
              isSuperAdmin={isSuperAdmin}
              signedPhotoUrls={signedRoomPhotoUrls}
              selected={selectedIds.has(r.id)}
              onToggleSelect={() => toggleSelect(r.id)}
              onEdit={() => openEdit(r)}
              onSetStatus={(next) => void setRoomStatus(r, next)}
              onSeparate={() => void runSeparate(r.id)}
            />
          ))}
        </div>
      ) : (
        <RoomListTable
          rooms={filteredRooms}
          properties={properties}
          memberships={memberships}
          isSuperAdmin={isSuperAdmin}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onEdit={openEdit}
          onSetStatus={(room, next) => void setRoomStatus(room, next)}
          onSeparate={(id) => void runSeparate(id)}
        />
      )}

      {filteredRooms.length === 0 ? <p style={{ color: "#888", marginTop: 24 }}>No rooms match filters.</p> : null}

      {showImportModal ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 60,
            padding: 20,
            overflow: "auto",
          }}
        >
          <div
            style={{
              maxWidth: 980,
              margin: "0 auto",
              background: "#fff",
              borderRadius: 14,
              padding: 18,
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>Import rooms from Excel</h2>
                <p style={{ marginTop: 6, color: "#666", fontSize: 13 }}>
                  Preview the parsed rows, then confirm to upsert into your rooms table.
                </p>
              </div>
              <button type="button" style={btn} onClick={() => setShowImportModal(false)} disabled={importBusy}>
                Close
              </button>
            </div>

            {importResults.length > 0 ? (
              <>
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13, color: "#666" }}>
                    Result:{" "}
                    <strong>
                      {importResults.filter((r) => r.ok).length} succeeded
                    </strong>{" "}
                    ·{" "}
                    <strong style={{ color: "#b00020" }}>
                      {importResults.filter((r) => !r.ok).length} failed
                    </strong>
                  </div>
                </div>
                <div style={{ marginTop: 12, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
                        <th style={{ padding: 8 }}>Row</th>
                        <th style={{ padding: 8 }}>Status</th>
                        <th style={{ padding: 8 }}>Action</th>
                        <th style={{ padding: 8 }}>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResults.map((r) => (
                        <tr key={r.rowNumber} style={{ borderBottom: "1px solid #eee" }}>
                          <td style={{ padding: 8 }}>{r.rowNumber}</td>
                          <td style={{ padding: 8, color: r.ok ? "#1b5e20" : "#b00020", fontWeight: 600 }}>
                            {r.ok ? "OK" : "Error"}
                          </td>
                          <td style={{ padding: 8 }}>{r.action}</td>
                          <td style={{ padding: 8, color: r.ok ? "#555" : "#b00020" }}>{r.error ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <div style={{ marginTop: 12, fontSize: 13, color: "#666" }}>
                  Parsed{" "}
                  <strong>{importPreviewRows.length}</strong>{" "}
                  row(s). Rows with errors are shown with validation messages.
                </div>
                <div style={{ marginTop: 12, overflowX: "auto", maxHeight: 520 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
                        <th style={{ padding: 8 }}>Row</th>
                        <th style={{ padding: 8 }}>Tenant</th>
                        <th style={{ padding: 8 }}>Property</th>
                        <th style={{ padding: 8 }}>Room</th>
                        <th style={{ padding: 8 }}>Type</th>
                        <th style={{ padding: 8 }}>Status</th>
                        <th style={{ padding: 8 }}>Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreviewRows.slice(0, 200).map((r) => (
                        <tr key={r.rowNumber} style={{ borderBottom: "1px solid #eee" }}>
                          <td style={{ padding: 8 }}>{r.rowNumber}</td>
                          <td style={{ padding: 8 }}>{r.normalized.tenant_name || "-"}</td>
                          <td style={{ padding: 8 }}>{r.normalized.property_name || "-"}</td>
                          <td style={{ padding: 8 }}>{r.normalized.room_name || "-"}</td>
                          <td style={{ padding: 8 }}>{r.normalized.space_type || "-"}</td>
                          <td style={{ padding: 8 }}>{r.normalized.space_status || "-"}</td>
                          <td style={{ padding: 8, color: r.errors.length ? "#b00020" : "#555" }}>
                            {r.errors.length ? r.errors.join("; ") : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importPreviewRows.length > 200 ? (
                    <p style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
                      Showing first 200 rows. Confirmation will attempt all rows.
                    </p>
                  ) : null}
                </div>
                <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={btnPrimary}
                    disabled={importBusy}
                    onClick={() => void confirmImport()}
                  >
                    {importBusy ? "Importing…" : "Confirm import"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {editing ? (
        <EditModal
          room={editing}
          properties={properties}
          memberships={memberships}
          isSuperAdmin={isSuperAdmin}
          signedPhotoUrls={signedRoomPhotoUrls}
          editBusy={editBusy}
          photoBusy={photoBusy}
          onClose={() => setEditing(null)}
          onSave={(ev) => void saveEdit(ev)}
          onChange={setEditing}
          onPhotoPick={onPhotoPick}
          onDeletePhoto={(ph) => void deletePhoto(ph)}
        />
      ) : null}
    </div>
  );
}

function RoomCard({
  room: r,
  properties,
  memberships,
  isSuperAdmin,
  signedPhotoUrls,
  selected,
  onToggleSelect,
  onEdit,
  onSetStatus,
  onSeparate,
}: {
  room: RoomRow;
  properties: PropertyRow[];
  memberships: MembershipRow[];
  isSuperAdmin: boolean;
  signedPhotoUrls: Map<string, string>;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onSetStatus: (next: "available" | "occupied" | "under_maintenance" | "reserved") => void;
  onSeparate: () => void;
}) {
  const tStyle = spaceTypeBadgeStyle(r.space_type);
  const sStyle = roomStatusBadgeStyle(r.space_status);
  const canWrite = canManageRoom(r, properties, memberships, isSuperAdmin);
  const showTenant = canSeeTenantDetails(r, properties, memberships, isSuperAdmin);
  const thumb = r.room_photos?.[0]?.storage_path;
  const thumbUrl = thumb ? signedPhotoUrls.get(thumb) : undefined;
  return (
    <article
      style={{
        border: `1px solid ${selected ? "#111" : "#e0e0e0"}`,
        borderRadius: 12,
        padding: 12,
        display: "grid",
        gap: 8,
        background: "#fff",
        boxShadow: selected ? "0 0 0 2px #111" : "none",
      }}
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt=""
          style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8 }}
        />
      ) : (
        <div style={{ height: 120, background: "#f1f3f5", borderRadius: 8 }} />
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>{r.name}</span>
        {r.room_number ? <span style={{ color: "#666", fontSize: 13 }}>#{r.room_number}</span> : null}
        {r.is_combination_parent ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 6px",
              borderRadius: 4,
              background: "#ede7f6",
              color: "#4527a0",
            }}
          >
            Combined
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: 6,
            background: tStyle.bg,
            color: tStyle.fg,
            border: `1px solid ${tStyle.bd}`,
          }}
        >
          {spaceTypeLabel(r.space_type)}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: 6,
            background: sStyle.bg,
            color: sStyle.fg,
            border: `1px solid ${sStyle.bd}`,
          }}
        >
          {formatSpaceStatusLabel(r.space_status)}
        </span>
      </div>
      <div style={{ fontSize: 13, color: "#444" }}>
        Floor {r.floor ?? "—"} · {r.size_m2 != null ? `${r.size_m2} m²` : "—"} · Cap. {r.capacity}
      </div>
      {r.space_type === "office" && showTenant && r.tenant_company_name ? (
        <div style={{ fontSize: 12, color: "#555" }}>Tenant: {r.tenant_company_name}</div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {canWrite && !r.is_combination_parent && r.space_status === "available" ? (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={selected} onChange={onToggleSelect} />
            Merge
          </label>
        ) : null}
        {canWrite ? (
          <button type="button" style={btn} onClick={onEdit}>
            Edit
          </button>
        ) : null}
        <Link
          href={`/bookings/calendar?propertyId=${encodeURIComponent(r.property_id)}`}
          style={{ ...btn, display: "inline-block", textDecoration: "none", color: "#111" }}
        >
          Bookings
        </Link>
        {canWrite ? (
          <StatusDropdown value={r.space_status} onChange={onSetStatus} />
        ) : null}
        {canWrite && r.is_combination_parent ? (
          <button type="button" style={{ ...btn, borderColor: "#b00020", color: "#b00020" }} onClick={onSeparate}>
            Separate rooms
          </button>
        ) : null}
      </div>
    </article>
  );
}

function RoomListTable({
  rooms,
  properties,
  memberships,
  isSuperAdmin,
  selectedIds,
  onToggleSelect,
  onEdit,
  onSetStatus,
  onSeparate,
}: {
  rooms: RoomRow[];
  properties: PropertyRow[];
  memberships: MembershipRow[];
  isSuperAdmin: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onEdit: (r: RoomRow) => void;
  onSetStatus: (r: RoomRow, next: "available" | "occupied" | "under_maintenance" | "reserved") => void;
  onSeparate: (id: string) => void;
}) {
  return (
    <div style={{ marginTop: 20, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
            <th style={{ padding: 8 }} />
            <th style={{ padding: 8 }}>Room</th>
            <th style={{ padding: 8 }}>Type</th>
            <th style={{ padding: 8 }}>Status</th>
            <th style={{ padding: 8 }}>Floor</th>
            <th style={{ padding: 8 }}>m²</th>
            <th style={{ padding: 8 }}>Cap</th>
            <th style={{ padding: 8 }}>Price</th>
            <th style={{ padding: 8 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => {
            const canWrite = canManageRoom(r, properties, memberships, isSuperAdmin);
            const tSt = spaceTypeBadgeStyle(r.space_type);
            const sSt = roomStatusBadgeStyle(r.space_status);
            return (
              <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 8 }}>
                  {canWrite && !r.is_combination_parent && r.space_status === "available" ? (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.id)}
                      onChange={() => onToggleSelect(r.id)}
                    />
                  ) : null}
                </td>
                <td style={{ padding: 8 }}>
                  {r.name}
                  {r.room_number ? ` · #${r.room_number}` : ""}
                  {r.is_combination_parent ? " · ⧉" : ""}
                </td>
                <td style={{ padding: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: tSt.bg,
                      color: tSt.fg,
                    }}
                  >
                    {spaceTypeLabel(r.space_type)}
                  </span>
                </td>
                <td style={{ padding: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: sSt.bg,
                      color: sSt.fg,
                    }}
                  >
                    {formatSpaceStatusLabel(r.space_status)}
                  </span>
                </td>
                <td style={{ padding: 8 }}>{r.floor ?? "—"}</td>
                <td style={{ padding: 8 }}>{r.size_m2 ?? "—"}</td>
                <td style={{ padding: 8 }}>{r.capacity}</td>
                <td style={{ padding: 8 }}>
                  {r.space_type === "office"
                    ? r.monthly_rent_eur != null
                      ? `€${r.monthly_rent_eur}/mo`
                      : "—"
                    : `€${r.hourly_price}/h`}
                </td>
                <td style={{ padding: 8 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {canWrite ? (
                      <button type="button" style={btn} onClick={() => onEdit(r)}>
                        Edit
                      </button>
                    ) : null}
                    <Link
                      href={`/bookings/calendar?propertyId=${encodeURIComponent(r.property_id)}`}
                      style={{ ...btn, display: "inline-block", textDecoration: "none", color: "#111" }}
                    >
                      Bookings
                    </Link>
                    {canWrite ? (
                      <StatusDropdown value={r.space_status} onChange={(next) => onSetStatus(r, next)} />
                    ) : null}
                    {canWrite && r.is_combination_parent ? (
                      <button type="button" style={btn} onClick={() => onSeparate(r.id)}>
                        Separate
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EditModal({
  room,
  properties,
  memberships,
  isSuperAdmin,
  signedPhotoUrls,
  editBusy,
  photoBusy,
  onClose,
  onSave,
  onChange,
  onPhotoPick,
  onDeletePhoto,
}: {
  room: RoomRow;
  properties: PropertyRow[];
  memberships: MembershipRow[];
  isSuperAdmin: boolean;
  signedPhotoUrls: Map<string, string>;
  editBusy: boolean;
  photoBusy: boolean;
  onClose: () => void;
  onSave: (ev: FormEvent<HTMLFormElement>) => void;
  onChange: (r: RoomRow) => void;
  onPhotoPick: (ev: ChangeEvent<HTMLInputElement>) => void;
  onDeletePhoto: (p: RoomPhoto) => void;
}) {
  const canWrite = canManageRoom(room, properties, memberships, isSuperAdmin);
  const showTenant = canSeeTenantDetails(room, properties, memberships, isSuperAdmin);
  const canToggleHideTenant = isPropertyOwner(room.property_id, properties, memberships, isSuperAdmin);
  if (!canWrite) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          display: "grid",
          placeItems: "center",
          zIndex: 50,
          padding: 16,
        }}
      >
        <div style={{ background: "#fff", padding: 24, borderRadius: 12, maxWidth: 400 }}>
          <p>You do not have permission to edit rooms.</p>
          <button type="button" style={btnPrimary} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const propName = properties.find((p) => p.id === room.property_id)?.name ?? "";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 50,
        overflow: "auto",
        padding: 24,
      }}
    >
      <form
        onSubmit={onSave}
        style={{
          maxWidth: 560,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 12,
          padding: 20,
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Edit room</h2>
          <button type="button" style={btn} onClick={onClose}>
            Close
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "#666" }}>
          Property: <strong>{propName}</strong>
        </p>

        <label style={{ display: "grid", gap: 4 }}>
          Name
          <input
            value={room.name}
            onChange={(e) => onChange({ ...room, name: e.target.value })}
            required
            style={{ padding: 8 }}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          Room number
          <input
            value={room.room_number ?? ""}
            onChange={(e) => onChange({ ...room, room_number: e.target.value || null })}
            style={{ padding: 8 }}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          Floor
          <input
            value={room.floor ?? ""}
            onChange={(e) => onChange({ ...room, floor: e.target.value || null })}
            style={{ padding: 8 }}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          Size (m²)
          <input
            type="number"
            min={0}
            step="0.01"
            value={room.size_m2 ?? ""}
            onChange={(e) =>
              onChange({
                ...room,
                size_m2: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            style={{ padding: 8 }}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          Capacity
          <input
            type="number"
            min={1}
            value={room.capacity}
            onChange={(e) => onChange({ ...room, capacity: Math.max(1, Number(e.target.value) || 1) })}
            style={{ padding: 8 }}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          Type
          <select
            value={room.space_type}
            onChange={(e) => onChange({ ...room, space_type: e.target.value })}
            style={{ padding: 8 }}
          >
            {SPACE_TYPES.map((t) => (
              <option key={t} value={t}>
                {spaceTypeLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          Status
          <select
            value={room.space_status}
            onChange={(e) => onChange({ ...room, space_status: e.target.value })}
            style={{ padding: 8 }}
          >
            <option value="available">Available</option>
            <option value="reserved">Reserved</option>
            <option value="occupied">Occupied</option>
            <option value="under_maintenance">Under maintenance</option>
            <option value="merged" disabled>
              Merged (read-only)
            </option>
          </select>
        </label>
        {room.is_combination_parent ? (
          <p style={{ fontSize: 12, color: "#666" }}>
            Combined space: use “Separate rooms” on the card to restore members.
          </p>
        ) : null}

        <label style={{ display: "grid", gap: 4 }}>
          Hourly price (€)
          <input
            type="number"
            min={0}
            step="0.01"
            value={room.hourly_price}
            onChange={(e) => onChange({ ...room, hourly_price: Number(e.target.value) || 0 })}
            style={{ padding: 8 }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={room.requires_approval}
            onChange={(e) => onChange({ ...room, requires_approval: e.target.checked })}
          />
          Requires approval for bookings
        </label>

        {room.space_type === "office" ? (
          <fieldset style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <legend>Office lease</legend>
            <label style={{ display: "grid", gap: 4, marginBottom: 8 }}>
              Monthly rent (€)
              <input
                type="number"
                min={0}
                step="0.01"
                value={room.monthly_rent_eur ?? ""}
                onChange={(e) =>
                  onChange({
                    ...room,
                    monthly_rent_eur: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                style={{ padding: 8 }}
              />
            </label>
            {showTenant ? (
              <>
                <label style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                  Tenant company
                  <input
                    value={room.tenant_company_name ?? ""}
                    onChange={(e) => onChange({ ...room, tenant_company_name: e.target.value || null })}
                    style={{ padding: 8 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                  Contact name
                  <input
                    value={room.tenant_contact_name ?? ""}
                    onChange={(e) => onChange({ ...room, tenant_contact_name: e.target.value || null })}
                    style={{ padding: 8 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                  Contact email
                  <input
                    type="email"
                    value={room.tenant_contact_email ?? ""}
                    onChange={(e) => onChange({ ...room, tenant_contact_email: e.target.value || null })}
                    style={{ padding: 8 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                  Contact phone
                  <input
                    value={room.tenant_contact_phone ?? ""}
                    onChange={(e) => onChange({ ...room, tenant_contact_phone: e.target.value || null })}
                    style={{ padding: 8 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                  Contract start
                  <input
                    type="date"
                    value={(room.contract_start ?? "").slice(0, 10)}
                    onChange={(e) => onChange({ ...room, contract_start: e.target.value || null })}
                    style={{ padding: 8 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                  Contract end
                  <input
                    type="date"
                    value={(room.contract_end ?? "").slice(0, 10)}
                    onChange={(e) => onChange({ ...room, contract_end: e.target.value || null })}
                    style={{ padding: 8 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                  Security deposit (€)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={room.security_deposit_eur ?? ""}
                    onChange={(e) =>
                      onChange({
                        ...room,
                        security_deposit_eur: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    style={{ padding: 8 }}
                  />
                </label>
              </>
            ) : (
              <p style={{ fontSize: 13, color: "#777", margin: 0 }}>
                Tenant details are hidden for your role (or by office privacy settings). An owner can disable
                &quot;Hide tenant in UI&quot; for managers to see this block.
              </p>
            )}
            {canToggleHideTenant ? (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={!!room.hide_tenant_in_ui}
                  onChange={(e) => onChange({ ...room, hide_tenant_in_ui: e.target.checked })}
                />
                Hide tenant details from managers (presentations / screen share)
              </label>
            ) : null}
          </fieldset>
        ) : null}

        {(room.space_type === "conference_room" || room.space_type === "venue") && (
          <fieldset style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <legend>Booking pricing</legend>
            <label style={{ display: "grid", gap: 4, marginBottom: 8 }}>
              Half day (€)
              <input
                type="number"
                min={0}
                step="0.01"
                value={room.half_day_price_eur ?? ""}
                onChange={(e) =>
                  onChange({
                    ...room,
                    half_day_price_eur: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                style={{ padding: 8 }}
              />
            </label>
            <label style={{ display: "grid", gap: 4, marginBottom: 8 }}>
              Full day (€)
              <input
                type="number"
                min={0}
                step="0.01"
                value={room.full_day_price_eur ?? ""}
                onChange={(e) =>
                  onChange({
                    ...room,
                    full_day_price_eur: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                style={{ padding: 8 }}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              Minimum booking (hours)
              <input
                type="number"
                min={0}
                step="0.25"
                value={room.min_booking_hours ?? ""}
                onChange={(e) =>
                  onChange({
                    ...room,
                    min_booking_hours: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                style={{ padding: 8 }}
              />
            </label>
          </fieldset>
        )}

        {room.space_type === "hot_desk" && (
          <fieldset style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <legend>Hot desk pricing</legend>
            <label style={{ display: "grid", gap: 4 }}>
              Daily price (€)
              <input
                type="number"
                min={0}
                step="0.01"
                value={room.daily_price_eur ?? ""}
                onChange={(e) =>
                  onChange({
                    ...room,
                    daily_price_eur: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                style={{ padding: 8 }}
              />
            </label>
          </fieldset>
        )}

        <fieldset style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <legend>Amenities</legend>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {AMENITY_KEYS.map((a) => (
              <label key={a.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!!(room as unknown as Record<string, boolean>)[a.key]}
                  onChange={(e) =>
                    onChange({ ...room, [a.key]: e.target.checked } as RoomRow)
                  }
                />
                {a.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <legend>Photos</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(room.room_photos ?? []).map((ph) => (
              <div key={ph.id} style={{ position: "relative" }}>
                {signedPhotoUrls.get(ph.storage_path) ? (
                  <img
                    src={signedPhotoUrls.get(ph.storage_path)}
                    alt=""
                    style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8 }}
                  />
                ) : (
                  <div style={{ width: 80, height: 80, background: "#eee", borderRadius: 8 }} />
                )}
                <button
                  type="button"
                  onClick={() => onDeletePhoto(ph)}
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 2,
                    padding: "2px 6px",
                    fontSize: 11,
                    borderRadius: 4,
                    border: "none",
                    background: "#b00020",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <label
            style={{
              marginTop: 8,
              display: "inline-block",
              cursor: photoBusy ? "wait" : "pointer",
            }}
          >
            <span
              style={{
                ...btnPrimary,
                display: "inline-block",
                padding: "8px 12px",
                borderRadius: 8,
              }}
            >
              {photoBusy ? "Uploading…" : "Add photos"}
            </span>
            <input
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={onPhotoPick}
              disabled={photoBusy}
            />
          </label>
        </fieldset>

        <button type="submit" style={btnPrimary} disabled={editBusy}>
          {editBusy ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
