import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  applyMarketingRowScopeFilter,
  getMarketingAccess,
  resolveMarketingInsertTenantId,
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
  const filtered = applyMarketingRowScopeFilter(
    supabase.from("marketing_sms").select("*").order("created_at", { ascending: false }).limit(100),
    resolved.scope,
  );

  const { data, error } = await filtered;
  if (error) {
    if (error.code === "42P01") return NextResponse.json({ sms: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ sms: data ?? [] });
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

  const resolvedT = resolveMarketingInsertTenantId(body, { tenantIds, isSuperAdmin });
  if (!resolvedT.ok) {
    return NextResponse.json({ error: resolvedT.error }, { status: resolvedT.status });
  }

  const message_text = String(body.message_text ?? "").trim();
  if (!message_text) return NextResponse.json({ error: "message_text required" }, { status: 400 });
  if (message_text.length > 480) return NextResponse.json({ error: "Message too long (max 480)" }, { status: 400 });

  const insert = {
    tenant_id: resolvedT.tenant_id,
    campaign_id: body.campaign_id ?? null,
    message_text,
    from_number: body.from_number != null ? String(body.from_number) : null,
    status: "draft",
    scheduled_at: body.scheduled_at ?? null,
  };

  const { data, error } = await supabase.from("marketing_sms").insert(insert).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sms: data });
}
