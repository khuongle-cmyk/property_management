import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RoomPayload = {
  id: string;
  bookable_space_id?: string | null;
  room_number?: string;
  room_name?: string;
  room_type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  color?: string | null;
  shape?: string;
  polygon_points?: unknown;
  label_x?: number | null;
  label_y?: number | null;
  is_rentable?: boolean;
  metadata?: Record<string, unknown>;
};

type ElementPayload = {
  id: string;
  element_type: string;
  x?: number;
  y?: number;
  width?: number | null;
  height?: number | null;
  rotation?: number;
  points?: unknown;
  style?: Record<string, unknown>;
  label?: string | null;
};

async function loadPlan(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, id: string) {
  const { data: plan, error } = await supabase.from("floor_plans").select("*").eq("id", id).maybeSingle();
  if (error) return { error: error.message };
  if (!plan) return { error: "NOT_FOUND" as const };
  return { plan };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id?.trim()) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const loaded = await loadPlan(supabase, id);
  if (loaded.error === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: 500 });

  const [{ data: rooms, error: rErr }, { data: elements, error: eErr }] = await Promise.all([
    supabase.from("floor_plan_rooms").select("*").eq("floor_plan_id", id).order("created_at"),
    supabase.from("floor_plan_elements").select("*").eq("floor_plan_id", id).order("created_at"),
  ]);
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 });

  return NextResponse.json({
    plan: loaded.plan,
    rooms: rooms ?? [],
    elements: elements ?? [],
  });
}

type PutBody = {
  name?: string;
  floor_number?: number;
  width_meters?: number;
  height_meters?: number;
  scale?: number;
  background_image_url?: string | null;
  background_opacity?: number;
  show_background?: boolean;
  canvas_data?: Record<string, unknown>;
  status?: "draft" | "published";
  rooms?: RoomPayload[];
  elements?: ElementPayload[];
};

async function syncRooms(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  floorPlanId: string,
  rooms: RoomPayload[],
) {
  const { data: existing, error: exErr } = await supabase.from("floor_plan_rooms").select("id").eq("floor_plan_id", floorPlanId);
  if (exErr) return exErr.message;
  const nextIds = new Set(rooms.map((r) => r.id).filter(Boolean));
  const toDelete = (existing ?? []).map((r: { id: string }) => r.id).filter((rid) => !nextIds.has(rid));
  if (toDelete.length) {
    const { error: delErr } = await supabase.from("floor_plan_rooms").delete().in("id", toDelete);
    if (delErr) return delErr.message;
  }
  for (const r of rooms) {
    if (!r.id) continue;
    const row = {
      id: r.id,
      floor_plan_id: floorPlanId,
      bookable_space_id: r.bookable_space_id ?? null,
      room_number: r.room_number ?? "",
      room_name: r.room_name ?? "",
      room_type: r.room_type ?? "office",
      x: r.x ?? 0,
      y: r.y ?? 0,
      width: r.width ?? 40,
      height: r.height ?? 40,
      rotation: r.rotation ?? 0,
      color: r.color ?? null,
      shape: r.shape ?? "rect",
      polygon_points: r.polygon_points ?? null,
      label_x: r.label_x ?? null,
      label_y: r.label_y ?? null,
      is_rentable: r.is_rentable ?? true,
      metadata: r.metadata ?? {},
    };
    const { error: upErr } = await supabase.from("floor_plan_rooms").upsert(row, { onConflict: "id" });
    if (upErr) return upErr.message;
  }
  return null;
}

async function syncElements(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  floorPlanId: string,
  elements: ElementPayload[],
) {
  const { data: existing, error: exErr } = await supabase.from("floor_plan_elements").select("id").eq("floor_plan_id", floorPlanId);
  if (exErr) return exErr.message;
  const nextIds = new Set(elements.map((e) => e.id).filter(Boolean));
  const toDelete = (existing ?? []).map((r: { id: string }) => r.id).filter((rid) => !nextIds.has(rid));
  if (toDelete.length) {
    const { error: delErr } = await supabase.from("floor_plan_elements").delete().in("id", toDelete);
    if (delErr) return delErr.message;
  }
  for (const el of elements) {
    if (!el.id) continue;
    const row = {
      id: el.id,
      floor_plan_id: floorPlanId,
      element_type: el.element_type,
      x: el.x ?? 0,
      y: el.y ?? 0,
      width: el.width ?? null,
      height: el.height ?? null,
      rotation: el.rotation ?? 0,
      points: el.points ?? null,
      style: el.style ?? {},
      label: el.label ?? null,
    };
    const { error: upErr } = await supabase.from("floor_plan_elements").upsert(row, { onConflict: "id" });
    if (upErr) return upErr.message;
  }
  return null;
}

async function handleSave(req: Request, id: string) {
  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const loaded = await loadPlan(supabase, id);
  if (loaded.error === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: 500 });

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim() || "Untitled";
  if (body.floor_number !== undefined) patch.floor_number = Math.round(Number(body.floor_number)) || 0;
  if (body.width_meters !== undefined) patch.width_meters = body.width_meters;
  if (body.height_meters !== undefined) patch.height_meters = body.height_meters;
  if (body.scale !== undefined) patch.scale = body.scale;
  if (body.background_image_url !== undefined) patch.background_image_url = body.background_image_url;
  if (body.background_opacity !== undefined) patch.background_opacity = body.background_opacity;
  if (body.show_background !== undefined) patch.show_background = body.show_background;
  if (body.canvas_data !== undefined) patch.canvas_data = body.canvas_data;
  if (body.status !== undefined) {
    if (!["draft", "published"].includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = body.status;
  }

  if (Object.keys(patch).length) {
    const { error: uErr } = await supabase.from("floor_plans").update(patch).eq("id", id);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });
  }

  if (body.rooms) {
    const err = await syncRooms(supabase, id, body.rooms);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }
  if (body.elements) {
    const err = await syncElements(supabase, id, body.elements);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id?.trim()) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  return handleSave(req, id);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id?.trim()) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  return handleSave(req, id);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id?.trim()) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error: elErr } = await supabase.from("floor_plan_elements").delete().eq("floor_plan_id", id);
  if (elErr) return NextResponse.json({ error: elErr.message }, { status: 400 });

  const { error: rmErr } = await supabase.from("floor_plan_rooms").delete().eq("floor_plan_id", id);
  if (rmErr) return NextResponse.json({ error: rmErr.message }, { status: 400 });

  const { error: planErr } = await supabase.from("floor_plans").delete().eq("id", id);
  if (planErr) return NextResponse.json({ error: planErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
