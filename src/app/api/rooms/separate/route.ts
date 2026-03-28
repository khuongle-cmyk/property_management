import { NextResponse } from "next/server";
import { userCanManageRoomsForTenant } from "@/lib/auth/tenant-roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type Body = {
  combinedSpaceId?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const combinedSpaceId = body.combinedSpaceId?.trim();
  if (!combinedSpaceId) {
    return NextResponse.json({ error: "combinedSpaceId is required" }, { status: 400 });
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

  const { data: parent, error: pErr } = await admin
    .from("bookable_spaces")
    .select("id, property_id, combination_id, is_combination_parent")
    .eq("id", combinedSpaceId)
    .maybeSingle();

  if (pErr || !parent) {
    return NextResponse.json({ error: "Combined room not found" }, { status: 404 });
  }

  const row = parent as {
    id: string;
    property_id: string;
    combination_id: string | null;
    is_combination_parent: boolean;
  };

  if (!row.is_combination_parent || !row.combination_id) {
    return NextResponse.json({ error: "Not a combined room parent" }, { status: 400 });
  }

  const { data: propRow } = await admin
    .from("properties")
    .select("tenant_id")
    .eq("id", row.property_id)
    .maybeSingle();

  const tenantId = (propRow as { tenant_id: string } | null)?.tenant_id;
  if (!tenantId) {
    return NextResponse.json({ error: "Property not found" }, { status: 400 });
  }

  const allowed = await userCanManageRoomsForTenant(supabase, user.id, tenantId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const combinationId = row.combination_id;

  const { data: members } = await admin
    .from("room_combination_members")
    .select("space_id")
    .eq("combination_id", combinationId);

  const memberIds = [...new Set((members ?? []).map((m) => m.space_id).filter(Boolean))] as string[];

  const { error: delJunction } = await admin
    .from("room_combination_members")
    .delete()
    .eq("combination_id", combinationId);

  if (delJunction) {
    return NextResponse.json({ error: delJunction.message }, { status: 500 });
  }

  if (memberIds.length > 0) {
    const { error: restoreErr } = await admin
      .from("bookable_spaces")
      .update({
        space_status: "available",
        combination_id: null,
        is_combination_parent: false,
      })
      .in("id", memberIds);

    if (restoreErr) {
      return NextResponse.json({ error: restoreErr.message }, { status: 500 });
    }
  }

  const { error: delParent } = await admin.from("bookable_spaces").delete().eq("id", row.id);
  if (delParent) {
    return NextResponse.json({ error: delParent.message }, { status: 500 });
  }

  const { error: delCombo } = await admin.from("room_combinations").delete().eq("id", combinationId);
  if (delCombo) {
    return NextResponse.json({ error: delCombo.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
