import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessMarketingRowByTenantId, getMarketingAccess } from "@/lib/marketing/access";
import { sanitizeMarketingEmailRow } from "@/lib/marketing/sanitize-marketing-email-row";
import { parseUuidOrNull } from "@/lib/uuid";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getMarketingAccess(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: sourceId } = await ctx.params;
  if (!sourceId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: src, error: fErr } = await supabase.from("marketing_emails").select("*").eq("id", sourceId).maybeSingle();
  if (fErr || !src) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = sanitizeMarketingEmailRow(src as Record<string, unknown>);
  const tid = row.tenant_id as string | null;
  if (!canAccessMarketingRowByTenantId(tid, { tenantIds, isSuperAdmin })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const insert = {
    tenant_id: tid,
    campaign_id: parseUuidOrNull(row.campaign_id),
    campaign_type: row.campaign_type != null && String(row.campaign_type).trim() !== "" ? String(row.campaign_type).trim() : null,
    subject: String(row.subject ?? "") + " (copy)",
    preview_text: row.preview_text ?? null,
    body_html: row.body_html ?? null,
    body_text: row.body_text ?? null,
    from_name: row.from_name ?? null,
    from_email: row.from_email ?? null,
    reply_to: row.reply_to ?? null,
    template_id: row.template_id ?? null,
    status: "draft",
    scheduled_at: null,
    sent_at: null,
    recipient_count: 0,
    open_count: 0,
    click_count: 0,
    unsubscribe_count: 0,
    bounce_count: 0,
  };

  const { data: created, error: iErr } = await supabase.from("marketing_emails").insert(insert).select("*").single();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  return NextResponse.json({ email: sanitizeMarketingEmailRow((created ?? {}) as Record<string, unknown>) });
}
