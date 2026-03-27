import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Body = {
  mappings?: Array<{
    costCenterCode?: string;
    costCenterName?: string;
    propertyId?: string;
    dataType?: "revenue" | "cost";
    category?: string;
    active?: boolean;
  }>;
};

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: mRows, error: mErr } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  const roleRows = (mRows ?? []).map((m) => ({
    role: (m.role ?? "").toLowerCase(),
    tenant_id: m.tenant_id,
  }));
  const isSuperAdmin = roleRows.some((m) => m.role === "super_admin");
  const tenantIds = [...new Set(roleRows.map((m) => m.tenant_id).filter(Boolean))] as string[];
  if (!isSuperAdmin && !tenantIds.length) return NextResponse.json({ ok: true, mappings: [] });

  let q = supabase
    .from("procountor_cost_center_mappings")
    .select("id, tenant_id, cost_center_code, cost_center_name, property_id, data_type, category, active, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (!isSuperAdmin) q = q.in("tenant_id", tenantIds);
  const { data, error } = await q;
  if (error) {
    if (error.code === "42P01") return NextResponse.json({ ok: true, mappings: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, mappings: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const mappings = body.mappings ?? [];
  if (!mappings.length) return NextResponse.json({ error: "No mappings provided" }, { status: 400 });

  const { data: mRows, error: mErr } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  const roleRows = (mRows ?? []).map((m) => ({
    role: (m.role ?? "").toLowerCase(),
    tenant_id: m.tenant_id,
  }));
  const isSuperAdmin = roleRows.some((m) => m.role === "super_admin");
  const allowedTenantIds = [...new Set(roleRows
    .filter((m) => ["super_admin", "owner", "manager"].includes(m.role))
    .map((m) => m.tenant_id)
    .filter(Boolean))] as string[];
  if (!isSuperAdmin && !allowedTenantIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let pQuery = supabase.from("properties").select("id, tenant_id");
  if (!isSuperAdmin) pQuery = pQuery.in("tenant_id", allowedTenantIds);
  const { data: properties, error: pErr } = await pQuery;
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  const propById = new Map((properties ?? []).map((p) => [p.id, p.tenant_id]));

  for (const m of mappings) {
    const key = (m.costCenterCode ?? "").trim();
    const pid = (m.propertyId ?? "").trim();
    if (!key || !pid) continue;
    const tid = propById.get(pid);
    if (!tid) continue;
    const dataType = m.dataType === "cost" ? "cost" : "revenue";
    const category = (m.category ?? "").trim();
    const active = m.active !== false;
    const { error } = await supabase
      .from("procountor_cost_center_mappings")
      .upsert(
        {
          tenant_id: tid,
          cost_center_code: key,
          cost_center_name: (m.costCenterName ?? "").trim() || null,
          property_id: pid,
          data_type: dataType,
          category,
          active,
          created_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,cost_center_code" },
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
