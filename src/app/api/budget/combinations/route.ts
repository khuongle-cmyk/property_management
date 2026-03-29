import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { budgetApiErrorPayload } from "@/lib/budget/api-errors";
import { getMembershipContext, userCanViewBudget } from "@/lib/budget/server-access";
import { normalizeMemberships } from "@/lib/reports/report-access";

export async function GET(req: Request) {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server configuration error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { memberships, canRunReports } = await getMembershipContext(supabase, user.id);
  if (!canRunReports) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tenantId = new URL(req.url).searchParams.get("tenantId")?.trim() ?? "";
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  if (!userCanViewBudget(memberships, tenantId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("budget_combinations")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ combinations: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { memberships, canManageAny } = await getMembershipContext(supabase, user.id);
  if (!canManageAny) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { isSuperAdmin } = normalizeMemberships(memberships);

  let body: {
    tenant_id?: string;
    name?: string;
    property_ids?: string[];
    include_admin?: boolean;
    is_default?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tenant_id = String(body.tenant_id ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!tenant_id || !name) return NextResponse.json({ error: "tenant_id and name required" }, { status: 400 });
  if (!userCanViewBudget(memberships, tenant_id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let propsQuery = supabase.from("properties").select("id");
  if (!isSuperAdmin) {
    propsQuery = propsQuery.eq("tenant_id", tenant_id);
  }
  const { data: props } = await propsQuery;
  const allowed = new Set((props ?? []).map((p: { id: string }) => p.id));
  const property_ids = (body.property_ids ?? []).filter((id) => allowed.has(id));

  if (body.is_default) {
    await supabase.from("budget_combinations").update({ is_default: false }).eq("tenant_id", tenant_id);
  }

  const { data, error } = await supabase
    .from("budget_combinations")
    .insert({
      tenant_id,
      name,
      property_ids,
      include_admin: body.include_admin !== false,
      is_default: !!body.is_default,
      created_by: user.id,
    })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json(budgetApiErrorPayload(error.message), { status: 500 });
  }
  return NextResponse.json({ combination: data });
}
