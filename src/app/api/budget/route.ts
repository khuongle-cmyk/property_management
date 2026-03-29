import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { budgetApiErrorPayload } from "@/lib/budget/api-errors";
import { getMembershipContext, userCanViewBudget } from "@/lib/budget/server-access";

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

  const { canRunReports, tenantIds, memberships } = await getMembershipContext(supabase, user.id);
  if (!canRunReports) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const tenantId = (searchParams.get("tenantId") ?? "").trim();
  const yearParam = searchParams.get("year");
  const yearNum = yearParam != null && yearParam !== "" ? Number(yearParam) : NaN;

  let q = supabase.from("budgets").select("*").order("budget_year", { ascending: false }).order("created_at", { ascending: false });
  if (Number.isFinite(yearNum) && yearNum >= 2000 && yearNum <= 2100) {
    q = q.eq("budget_year", yearNum);
  }
  if (tenantId) {
    if (!userCanViewBudget(memberships, tenantId)) {
      return NextResponse.json({ error: "Forbidden for tenant" }, { status: 403 });
    }
    q = q.eq("tenant_id", tenantId);
  } else if (tenantIds.length > 0) {
    q = q.in("tenant_id", tenantIds);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ budgets: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { canManageAny, memberships } = await getMembershipContext(supabase, user.id);
  if (!canManageAny) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: {
    tenant_id?: string;
    name?: string;
    budget_year?: number;
    budget_type?: string;
    budget_scope?: string;
    property_id?: string | null;
    notes?: string | null;
    opening_cash_balance?: number;
    parent_budget_id?: string | null;
    version_label?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tenant_id = String(body.tenant_id ?? "").trim();
  if (!tenant_id) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });
  if (!userCanViewBudget(memberships, tenant_id)) {
    return NextResponse.json({ error: "Forbidden for tenant" }, { status: 403 });
  }

  const budget_scope =
    String(body.budget_scope ?? "property").toLowerCase() === "administration" ? "administration" : "property";

  const name =
    String(body.name ?? "").trim() ||
    (budget_scope === "administration"
      ? `Administration ${body.budget_year ?? new Date().getFullYear()}`
      : `Budget ${body.budget_year ?? new Date().getFullYear()}`);
  const budget_year = Number(body.budget_year);
  if (!Number.isFinite(budget_year) || budget_year < 2000 || budget_year > 2100) {
    return NextResponse.json({ error: "Invalid budget_year" }, { status: 400 });
  }

  const property_id =
    budget_scope === "administration" ? null : String(body.property_id ?? "").trim() || null;
  if (budget_scope === "property" && !property_id) {
    return NextResponse.json({ error: "property_id required for property budgets" }, { status: 400 });
  }

  const row = {
    tenant_id,
    property_id,
    budget_scope,
    name,
    budget_year,
    budget_type: body.budget_type === "reforecast" ? "reforecast" : "annual",
    status: "draft" as const,
    notes: body.notes ?? null,
    created_by: user.id,
    opening_cash_balance: Number(body.opening_cash_balance) || 0,
    parent_budget_id: body.parent_budget_id ?? null,
    version_label: body.version_label ?? null,
  };

  const { data, error } = await supabase.from("budgets").insert(row).select("*").single();
  if (error) {
    return NextResponse.json(budgetApiErrorPayload(error.message), { status: 500 });
  }
  return NextResponse.json({ budget: data });
}
