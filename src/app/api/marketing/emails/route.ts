import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  applyMarketingTenantIdsFilter,
  getMarketingAccess,
  marketingScopeTenantIds,
  resolveMarketingTenantScope,
} from "@/lib/marketing/access";

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getMarketingAccess(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const resolved = await resolveMarketingTenantScope(supabase, url, { tenantIds, isSuperAdmin });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const scopeIds = marketingScopeTenantIds(resolved.scope);
  const filtered = applyMarketingTenantIdsFilter(
    supabase.from("marketing_emails").select("*").order("created_at", { ascending: false }).limit(100),
    scopeIds,
  );
  if (!filtered) return NextResponse.json({ emails: [] });

  const { data, error } = await filtered;
  if (error) {
    if (error.code === "42P01") return NextResponse.json({ emails: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ emails: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getMarketingAccess(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tenantId = String(body.tenant_id ?? body.tenantId ?? "").trim();
  if (!tenantId || (!isSuperAdmin && !tenantIds.includes(tenantId))) {
    return NextResponse.json({ error: "Invalid tenant" }, { status: 400 });
  }

  const insert = {
    tenant_id: tenantId,
    campaign_id: body.campaign_id ?? null,
    subject: String(body.subject ?? ""),
    preview_text: body.preview_text != null ? String(body.preview_text) : null,
    body_html: body.body_html != null ? String(body.body_html) : null,
    body_text: body.body_text != null ? String(body.body_text) : null,
    from_name: body.from_name != null ? String(body.from_name) : null,
    from_email: body.from_email != null ? String(body.from_email) : null,
    reply_to: body.reply_to != null ? String(body.reply_to) : null,
    template_id: body.template_id != null ? String(body.template_id) : null,
    status: "draft",
    scheduled_at: body.scheduled_at ?? null,
  };

  const { data, error } = await supabase.from("marketing_emails").insert(insert).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ email: data });
}
