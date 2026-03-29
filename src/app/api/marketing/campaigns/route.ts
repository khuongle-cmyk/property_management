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
    supabase.from("marketing_campaigns").select("*").order("updated_at", { ascending: false }).limit(200),
    scopeIds,
  );
  if (!filtered) return NextResponse.json({ campaigns: [] });

  const { data, error } = await filtered;
  if (error) {
    if (error.code === "42P01") return NextResponse.json({ campaigns: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ campaigns: data ?? [] });
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

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const insert = {
    tenant_id: tenantId,
    name,
    description: body.description != null ? String(body.description) : null,
    campaign_type: String(body.campaign_type ?? "email"),
    status: String(body.status ?? "draft"),
    target_audience: String(body.target_audience ?? "all_leads"),
    target_segment_filters: (body.target_segment_filters as object) ?? {},
    start_date: body.start_date ?? null,
    end_date: body.end_date ?? null,
    budget: body.budget != null ? Number(body.budget) : null,
    created_by: user.id,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from("marketing_campaigns").insert(insert).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
