import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { AMENITY_KEYS, SPACE_TYPES } from "@/lib/rooms/labels";
import type { SpaceType } from "@/lib/rooms/labels";
import type { RoomStatus } from "@/lib/rooms/labels";

const STATUS_VALUES = ["available", "occupied", "under_maintenance"] as const;

const SPACE_TYPE_SET = new Set<string>([...SPACE_TYPES]);
const STATUS_SET = new Set<string>([...STATUS_VALUES]);

type ImportRow = {
  rowNumber: number;
  tenant_name?: string | null;
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

function parseAmenitiesRaw(amenitiesRaw: string | null | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of AMENITY_KEYS) out[k.key] = false;

  const raw = amenitiesRaw?.trim();
  if (!raw) return out;

  const tokens = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  for (const token of tokens) {
    const normalized = token.startsWith("amenity_") ? token : `amenity_${token}`;
    if (normalized in out) out[normalized] = true;
  }
  return out;
}

function appendAmenitiesToNotes(
  notes: string | null | undefined,
  amenitiesRaw: string | null | undefined
): string | null {
  const base = (notes ?? "").trim();
  const am = (amenitiesRaw ?? "").trim();
  if (!am) return base || null;
  const suffix = `Amenities: ${am}`;
  return base ? `${base}\n${suffix}` : suffix;
}

function isMissingAmenityColumnsError(msg: string): boolean {
  const s = msg.toLowerCase();
  return s.includes("amenity_") && s.includes("column") && s.includes("schema cache");
}

export async function POST(req: Request) {
  let body: { rows?: ImportRow[] };
  try {
    body = (await req.json()) as { rows?: ImportRow[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rows = body.rows ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server misconfigured";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Preload memberships for access checks.
  const { data: memberships, error: mErr } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id);

  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }

  const roles = (memberships ?? []).map((m: { role?: string | null }) => (m.role ?? "").toLowerCase());
  const isSuperAdmin = roles.includes("super_admin");

  const manageableTenantIds = new Set(
    (memberships ?? [])
      .filter((m: { tenant_id?: string | null; role?: string | null }) => {
        const r = (m.role ?? "").toLowerCase();
        return r === "owner" || r === "manager";
      })
      .map((m: { tenant_id?: string | null }) => m.tenant_id)
      .filter(Boolean) as string[]
  );

  async function canWriteProperty(propertyTenantId: string): Promise<boolean> {
    if (isSuperAdmin) return true;
    return manageableTenantIds.has(propertyTenantId);
  }

  const results: Array<{
    rowNumber: number;
    ok: boolean;
    action: "insert" | "update" | "skip";
    room_id?: string;
    error?: string;
  }> = [];

  for (const row of rows) {
    const rn = row.rowNumber;
    try {
      const tenantName = row.tenant_name?.trim() ?? "";
      const propertyName = row.property_name?.trim();
      const roomName = row.room_name?.trim();
      const roomType = row.space_type?.trim();

      if (!propertyName) throw new Error("property_name is required");
      if (!roomName) throw new Error("room_name is required");
      if (!roomType) throw new Error("space_type is required");
      if (!tenantName) throw new Error("tenant_name is required");
      if (!SPACE_TYPE_SET.has(roomType)) throw new Error(`Invalid space_type: ${roomType}`);

      const status = (row.space_status ?? "").trim();
      if (!status || !STATUS_SET.has(status)) throw new Error(`Invalid space_status: ${status}`);

      const capacity = row.capacity;
      if (capacity == null || !Number.isFinite(capacity) || capacity < 1) {
        throw new Error("capacity must be a number >= 1");
      }

      const hourlyPrice = row.hourly_price ?? null;
      const monthlyRent = row.monthly_rent ?? null;
      const amenitiesRaw = row.amenities?.trim() ?? null;
      if (row.requires_approval == null) {
        throw new Error("requires_approval must be yes/no");
      }
      const requiresApprovalResolved = !!row.requires_approval;

      // Office: monthly_rent required; others: hourly_price required.
      if (roomType === "office") {
        if (monthlyRent == null || !Number.isFinite(monthlyRent) || monthlyRent < 0) {
          throw new Error("monthly_rent is required and must be >= 0 for office");
        }
      } else {
        if (hourlyPrice == null || !Number.isFinite(hourlyPrice) || hourlyPrice < 0) {
          throw new Error("hourly_price is required and must be >= 0 for non-office rooms");
        }
      }

      // Resolve tenant by name, then property by tenant + exact property name match.
      const { data: tenantRow, error: tenantErr } = await admin
        .from("tenants")
        .select("id")
        .eq("name", tenantName)
        .maybeSingle();

      if (tenantErr) throw new Error(tenantErr.message);
      if (!tenantRow) throw new Error(`Tenant not found: ${tenantName}`);

      const { data: propRows, error: propErr } = await admin
        .from("properties")
        .select("id, tenant_id")
        .eq("tenant_id", tenantRow.id)
        .eq("name", propertyName)
        .limit(2);

      if (propErr) throw new Error(propErr.message);
      if (!propRows || propRows.length === 0) {
        throw new Error(`Property not found for tenant: ${propertyName}`);
      }
      if (propRows.length > 1) {
        throw new Error(`Multiple properties found for tenant '${tenantName}' and property '${propertyName}'`);
      }

      const prop = propRows[0] as { id: string; tenant_id: string };

      if (!(await canWriteProperty((prop as { tenant_id: string }).tenant_id))) {
        throw new Error("Forbidden: you do not manage this property");
      }

      const basePatch: Record<string, unknown> = {
        property_id: prop.id,
        name: roomName,
        room_number: row.room_number?.trim() ? row.room_number.trim() : null,
        floor: row.floor?.trim() ? row.floor.trim() : null,
        capacity: Math.floor(capacity),
        size_m2: row.size_m2 == null ? null : Number(row.size_m2),
        space_type: roomType as SpaceType,
        requires_approval: requiresApprovalResolved,
        space_status: status as RoomStatus,
        hourly_price: roomType === "office" ? 0 : Number(hourlyPrice ?? 0),
        monthly_rent_eur: roomType === "office" ? Number(monthlyRent ?? 0) : null,
        notes: row.notes?.trim() ? row.notes.trim() : null,
      };
      const patchWithAmenities: Record<string, unknown> = {
        ...basePatch,
        ...parseAmenitiesRaw(amenitiesRaw),
      };
      const patchFallbackNoAmenityColumns: Record<string, unknown> = {
        ...basePatch,
        notes: appendAmenitiesToNotes(basePatch.notes as string | null, amenitiesRaw),
      };

      // Upsert heuristic: prefer room_number; fallback to (name, space_type).
      let existingId: string | null = null;
      if (row.room_number?.trim()) {
        const { data: existing, error: exErr } = await admin
          .from("bookable_spaces")
          .select("id")
          .eq("property_id", prop.id)
          .eq("room_number", row.room_number.trim())
          .maybeSingle();
        if (exErr) throw new Error(exErr.message);
        existingId = existing?.id ?? null;
      } else {
        const { data: existing, error: exErr } = await admin
          .from("bookable_spaces")
          .select("id")
          .eq("property_id", prop.id)
          .eq("name", roomName)
          .eq("space_type", roomType)
          .maybeSingle();
        if (exErr) throw new Error(exErr.message);
        existingId = existing?.id ?? null;
      }

      if (existingId) {
        let { error: uErr } = await admin
          .from("bookable_spaces")
          .update(patchWithAmenities)
          .eq("id", existingId);
        if (uErr && isMissingAmenityColumnsError(uErr.message)) {
          const retry = await admin
            .from("bookable_spaces")
            .update(patchFallbackNoAmenityColumns)
            .eq("id", existingId);
          uErr = retry.error;
        }
        if (uErr) throw new Error(uErr.message);
        results.push({ rowNumber: rn, ok: true, action: "update", room_id: existingId });
      } else {
        let { data: inserted, error: insErr } = await admin
          .from("bookable_spaces")
          .insert(patchWithAmenities)
          .select("id")
          .maybeSingle();
        if (insErr && isMissingAmenityColumnsError(insErr.message)) {
          const retry = await admin
            .from("bookable_spaces")
            .insert(patchFallbackNoAmenityColumns)
            .select("id")
            .maybeSingle();
          inserted = retry.data;
          insErr = retry.error;
        }
        if (insErr) throw new Error(insErr.message);
        const id = inserted?.id as string | undefined;
        results.push({ rowNumber: rn, ok: true, action: "insert", room_id: id });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed";
      results.push({ rowNumber: rn, ok: false, action: "skip", error: msg });
    }
  }

  return NextResponse.json({ ok: true, results });
}

