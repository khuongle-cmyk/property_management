import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessMarketingRowByTenantId, getMarketingAccess } from "@/lib/marketing/access";

type Ctx = { params: Promise<{ regId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getMarketingAccess(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { regId } = await ctx.params;
  if (!regId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: reg, error: rErr } = await supabase
    .from("marketing_event_registrations")
    .select("id, event_id")
    .eq("id", regId)
    .maybeSingle();
  if (rErr || !reg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: ev } = await supabase.from("marketing_events").select("tenant_id").eq("id", (reg as { event_id: string }).event_id).maybeSingle();
  const tid = (ev as { tenant_id: string | null } | null)?.tenant_id ?? null;
  if (!canAccessMarketingRowByTenantId(tid, { tenantIds, isSuperAdmin })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { status?: string; notes?: string; checked_in?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.status != null) patch.status = body.status;
  if (body.notes != null) patch.notes = body.notes;
  if (body.checked_in === true) {
    patch.checked_in_at = new Date().toISOString();
    patch.status = "attended";
  }

  const { data, error } = await supabase.from("marketing_event_registrations").update(patch).eq("id", regId).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ registration: data });
}
