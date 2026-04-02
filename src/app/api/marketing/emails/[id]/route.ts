import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessMarketingRowByTenantId, getMarketingAccess } from "@/lib/marketing/access";
import { sanitizeMarketingEmailRow } from "@/lib/marketing/sanitize-marketing-email-row";
import { parseUuidOrNull } from "@/lib/uuid";

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

  const { data: row, error } = await supabase.from("marketing_emails").select("*").eq("id", id).maybeSingle();
  if (error || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const tid = (row as { tenant_id: string | null }).tenant_id;
  if (!canAccessMarketingRowByTenantId(tid, { tenantIds, isSuperAdmin })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ email: sanitizeMarketingEmailRow(row as Record<string, unknown>) });
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

  const { data: row, error: fErr } = await supabase.from("marketing_emails").select("tenant_id, status").eq("id", id).maybeSingle();
  if (fErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const tid = (row as { tenant_id: string | null }).tenant_id;
  if (!canAccessMarketingRowByTenantId(tid, { tenantIds, isSuperAdmin })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if ((row as { status: string }).status === "sent") {
    return NextResponse.json({ error: "Cannot edit a sent email" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const k of [
    "subject",
    "preview_text",
    "body_html",
    "body_text",
    "from_name",
    "from_email",
    "reply_to",
    "template_id",
    "scheduled_at",
    "status",
    "campaign_type",
  ] as const) {
    if (k in body) patch[k] = body[k];
  }
  if ("campaign_id" in body) {
    patch.campaign_id = parseUuidOrNull(body.campaign_id);
  }

  const { data, error } = await supabase.from("marketing_emails").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ email: sanitizeMarketingEmailRow((data ?? {}) as Record<string, unknown>) });
}
