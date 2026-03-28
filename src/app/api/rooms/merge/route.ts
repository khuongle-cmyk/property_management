import { NextResponse } from "next/server";
import { userCanManageRoomsForTenant } from "@/lib/auth/tenant-roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type Body = {
  memberSpaceIds?: string[];
  displayName?: string;
  spaceType?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = body.memberSpaceIds?.filter(Boolean) ?? [];
  const displayName = body.displayName?.trim();
  if (ids.length < 2) {
    return NextResponse.json({ error: "Select at least two rooms" }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  }

  const spaceType = body.spaceType ?? "venue";
  if (!["conference_room", "venue", "hot_desk", "office"].includes(spaceType)) {
    return NextResponse.json({ error: "Invalid spaceType" }, { status: 400 });
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

  const { data: rows, error: qErr } = await admin
    .from("bookable_spaces")
    .select(
      "id, property_id, capacity, size_m2, hourly_price, requires_approval, floor, room_number, space_type, space_status, combination_id, is_combination_parent, merged_into_combination_id"
    )
    .in("id", ids);

  if (qErr || !rows?.length) {
    return NextResponse.json({ error: qErr?.message ?? "Spaces not found" }, { status: 400 });
  }

  const list = rows as Array<{
    id: string;
    property_id: string;
    capacity: number;
    size_m2: number | null;
    hourly_price: number;
    requires_approval: boolean;
    floor: string | null;
    space_status: string;
    combination_id: string | null;
    is_combination_parent: boolean;
  }>;

  const propIds = [...new Set(list.map((r) => r.property_id))];
  if (propIds.length !== 1) {
    return NextResponse.json({ error: "All rooms must belong to the same property" }, { status: 400 });
  }

  const propertyId = propIds[0];

  const { data: propRow } = await admin
    .from("properties")
    .select("tenant_id")
    .eq("id", propertyId)
    .maybeSingle();

  const tenantId = (propRow as { tenant_id: string } | null)?.tenant_id;
  if (!tenantId) {
    return NextResponse.json({ error: "Property not found" }, { status: 400 });
  }

  const canWrite = await userCanManageRoomsForTenant(supabase, user.id, tenantId);
  if (!canWrite) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  for (const r of list) {
    if (r.space_status === "merged") {
      return NextResponse.json({ error: "One of the rooms is already merged" }, { status: 400 });
    }
    if (r.combination_id || r.is_combination_parent) {
      return NextResponse.json({ error: "One of the rooms is already part of a combination" }, { status: 400 });
    }
    if (r.space_status !== "available") {
      return NextResponse.json({ error: "All rooms must be available to merge" }, { status: 400 });
    }
  }

  const totalCap = list.reduce((s, r) => s + (r.capacity ?? 0), 0);
  const totalM2 = list.reduce((s, r) => s + (Number(r.size_m2) || 0), 0);
  const maxHourly = Math.max(...list.map((r) => Number(r.hourly_price) || 0));
  const anyApproval = list.some((r) => r.requires_approval);

  const { data: combo, error: cErr } = await admin
    .from("room_combinations")
    .insert({ property_id: propertyId, display_name: displayName })
    .select("id")
    .single();

  if (cErr || !combo) {
    return NextResponse.json({ error: cErr?.message ?? "Could not create combination" }, { status: 500 });
  }

  const combinationId = (combo as { id: string }).id;

  const { data: parent, error: pErr } = await admin
    .from("bookable_spaces")
    .insert({
      property_id: propertyId,
      name: displayName,
      room_number: "COMBO",
      space_type: spaceType,
      capacity: Math.max(1, totalCap || list.length),
      size_m2: totalM2 || null,
      floor: list[0].floor ?? null,
      hourly_price: maxHourly,
      requires_approval: anyApproval,
      space_status: "available",
      combination_id: combinationId,
      is_combination_parent: true,
    })
    .select("id")
    .single();

  if (pErr || !parent) {
    await admin.from("room_combinations").delete().eq("id", combinationId);
    return NextResponse.json({ error: pErr?.message ?? "Could not create combined room" }, { status: 500 });
  }

  const parentId = (parent as { id: string }).id;

  const memberRows = ids.map((spaceId) => ({ combination_id: combinationId, space_id: spaceId }));
  const { error: mErr } = await admin.from("room_combination_members").insert(memberRows);
  if (mErr) {
    await admin.from("bookable_spaces").delete().eq("id", parentId);
    await admin.from("room_combinations").delete().eq("id", combinationId);
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }

  const { error: uErr } = await admin
    .from("bookable_spaces")
    .update({ space_status: "merged", combination_id: combinationId, is_combination_parent: false })
    .in("id", ids);

  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, combinationId, combinedSpaceId: parentId });
}
