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
    supabase.from("marketing_analytics").select("*").order("date", { ascending: false }).limit(400),
    scopeIds,
  );
  if (!filtered) return NextResponse.json({ rows: [] });

  const { data, error } = await filtered;
  if (error) {
    if (error.code === "42P01") return NextResponse.json({ rows: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [] });
}
