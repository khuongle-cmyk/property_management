import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildConsolidatedAnnualPL, buildConsolidatedMonthlySeries, type BudgetLinesBundle } from "@/lib/budget/consolidated-pl";
import { getMembershipContext, userCanViewBudget } from "@/lib/budget/server-access";
import { normalizeMemberships } from "@/lib/reports/report-access";

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { memberships, canRunReports } = await getMembershipContext(supabase, user.id);
  if (!canRunReports) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { isSuperAdmin } = normalizeMemberships(memberships);

  const { searchParams } = new URL(req.url);
  const tenantId = (searchParams.get("tenantId") ?? "").trim();
  const year = Number(searchParams.get("year"));
  const includeAdmin = searchParams.get("includeAdmin") !== "false";
  const propertyIdsRaw = searchParams.getAll("propertyId");
  const propertyIds = [...new Set(propertyIdsRaw.map((s) => s.trim()).filter(Boolean))];

  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "year required" }, { status: 400 });
  }
  if (!userCanViewBudget(memberships, tenantId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const normUuid = (s: string) => s.trim().toLowerCase();
  const tenantNorm = normUuid(tenantId);

  // Validate each requested property: must exist under RLS; non–super-admins must stay within the selected tenant.
  if (propertyIds.length > 0) {
    const idNormList = propertyIds.map(normUuid);
    let propQ = supabase.from("properties").select("id, tenant_id").in("id", idNormList);
    if (!isSuperAdmin) {
      propQ = propQ.eq("tenant_id", tenantNorm);
    }
    const { data: propRows, error: propErr } = await propQ;
    if (propErr) return NextResponse.json({ error: propErr.message }, { status: 500 });
    const byIdNorm = new Map(
      (propRows ?? []).map((r: { id: string; tenant_id: string }) => [normUuid(r.id), r.tenant_id]),
    );
    for (const pid of propertyIds) {
      const key = normUuid(pid);
      const propTenant = byIdNorm.get(key);
      if (!propTenant) {
        return NextResponse.json({ error: `Invalid property: ${pid}` }, { status: 400 });
      }
      if (!isSuperAdmin && normUuid(String(propTenant)) !== tenantNorm) {
        return NextResponse.json(
          { error: `Invalid property: ${pid} (not under the selected organization)` },
          { status: 400 },
        );
      }
    }
  }

  const { data: budgetRows, error: bErr } = await supabase
    .from("budgets")
    .select("id, name, budget_year, budget_scope, property_id, tenant_id")
    .eq("tenant_id", tenantNorm)
    .eq("budget_year", year);
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  const selectedNorm = propertyIds.length === 0 ? null : new Set(propertyIds.map(normUuid));

  const wantedIds: string[] = [];
  for (const row of budgetRows ?? []) {
    const r = row as { id: string; budget_scope: string; property_id: string | null };
    if (r.budget_scope === "administration") {
      if (includeAdmin) wantedIds.push(r.id);
      continue;
    }
    if (
      r.budget_scope === "property" &&
      r.property_id &&
      (!selectedNorm || selectedNorm.has(normUuid(r.property_id)))
    ) {
      wantedIds.push(r.id);
    }
  }

  if (wantedIds.length === 0) {
    return NextResponse.json({
      year,
      pl: buildConsolidatedAnnualPL(year, []),
      monthly: buildConsolidatedMonthlySeries(year, []),
      bundlesUsed: [],
    });
  }

  const [rev, cost, cx] = await Promise.all([
    supabase.from("budget_revenue_lines").select("budget_id, month, year, category, budgeted_amount").in("budget_id", wantedIds),
    supabase.from("budget_cost_lines").select("budget_id, month, year, cost_type, budgeted_amount").in("budget_id", wantedIds),
    supabase.from("budget_capex_lines").select("budget_id, estimated_cost, planned_date").in("budget_id", wantedIds),
  ]);
  if (rev.error) return NextResponse.json({ error: rev.error.message }, { status: 500 });
  if (cost.error) return NextResponse.json({ error: cost.error.message }, { status: 500 });
  if (cx.error) return NextResponse.json({ error: cx.error.message }, { status: 500 });

  const byBudget = new Map<string, BudgetLinesBundle>();
  for (const id of wantedIds) {
    const meta = (budgetRows ?? []).find((x: { id: string }) => x.id === id) as BudgetLinesBundle["budget"];
    byBudget.set(id, {
      budget: {
        id,
        name: String(meta?.name ?? ""),
        budget_year: year,
        budget_scope: String((meta as { budget_scope?: string })?.budget_scope ?? "property"),
        property_id: (meta as { property_id: string | null })?.property_id ?? null,
      },
      revenueLines: [],
      costLines: [],
      capexLines: [],
    });
  }
  for (const row of rev.data ?? []) {
    const o = row as { budget_id: string; month: number; year: number; category: string; budgeted_amount: unknown };
    const b = byBudget.get(o.budget_id);
    if (b) b.revenueLines.push({ month: o.month, year: o.year, category: o.category, budgeted_amount: o.budgeted_amount as number });
  }
  for (const row of cost.data ?? []) {
    const o = row as { budget_id: string; month: number; year: number; cost_type: string; budgeted_amount: unknown };
    const b = byBudget.get(o.budget_id);
    if (b) b.costLines.push({ month: o.month, year: o.year, cost_type: o.cost_type, budgeted_amount: o.budgeted_amount as number });
  }
  for (const row of cx.data ?? []) {
    const o = row as { budget_id: string; estimated_cost: unknown; planned_date: string | null };
    const b = byBudget.get(o.budget_id);
    if (b) b.capexLines.push({ estimated_cost: o.estimated_cost as number, planned_date: o.planned_date });
  }

  const bundles = [...byBudget.values()];
  const pl = buildConsolidatedAnnualPL(year, bundles);
  const monthly = buildConsolidatedMonthlySeries(year, bundles);

  return NextResponse.json({
    year,
    pl,
    monthly,
    bundlesUsed: bundles.map((b) => ({
      id: b.budget.id,
      name: b.budget.name,
      budget_scope: b.budget.budget_scope,
      property_id: b.budget.property_id,
    })),
  });
}
