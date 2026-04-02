import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessMarketingRowByTenantId, getMarketingAccess } from "@/lib/marketing/access";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getMarketingAccess(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: ev, error } = await supabase.from("marketing_events").select("*").eq("id", id).maybeSingle();
  if (error || !ev) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const tid = (ev as { tenant_id: string | null }).tenant_id;
  if (!canAccessMarketingRowByTenantId(tid, { tenantIds, isSuperAdmin })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: regs } = await supabase
    .from("marketing_event_registrations")
    .select("*")
    .eq("event_id", id)
    .order("registered_at", { ascending: false });

  return NextResponse.json({ event: ev, registrations: regs ?? [] });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getMarketingAccess(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: row, error: fErr } = await supabase.from("marketing_events").select("tenant_id").eq("id", id).maybeSingle();
  if (fErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const tid = (row as { tenant_id: string | null }).tenant_id;
  if (!canAccessMarketingRowByTenantId(tid, { tenantIds, isSuperAdmin })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const k of [
    "name",
    "description",
    "event_type",
    "start_datetime",
    "end_datetime",
    "location",
    "max_attendees",
    "is_public",
    "registration_required",
    "registration_deadline",
    "price",
    "status",
    "cover_image_url",
    "property_id",
    "slug",
  ] as const) {
    if (k in body) patch[k] = body[k];
  }

  const { data, error } = await supabase.from("marketing_events").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}
