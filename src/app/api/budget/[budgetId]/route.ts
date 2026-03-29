import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMembershipContext, loadBudget, userCanViewBudget } from "@/lib/budget/server-access";

type Ctx = { params: Promise<{ budgetId: string }> };

/** Headcount / CapEx / occupancy tables may be missing in minimal DBs — do not fail the whole bundle. */
async function selectBudgetLinesOrEmpty(
  supabase: SupabaseClient,
  table: string,
  budgetId: string,
): Promise<unknown[]> {
  const { data, error } = await supabase.from(table).select("*").eq("budget_id", budgetId);
  if (error) {
    console.error(`[GET /api/budget/[budgetId]] ${table} failed:`, error.code, error.message, { budgetId });
    if (error.code === "42P01") return [];
    return [];
  }
  return data ?? [];
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { budgetId } = await ctx.params;
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { memberships, canRunReports } = await getMembershipContext(supabase, user.id);
    if (!canRunReports) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { budget, error: loadErr } = await loadBudget(supabase, budgetId);
    if (loadErr) {
      console.error("[GET /api/budget/[budgetId]] loadBudget:", loadErr, { budgetId });
      return NextResponse.json({ error: loadErr }, { status: 500 });
    }
    if (!budget) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!userCanViewBudget(memberships, budget.tenant_id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [rev, cost] = await Promise.all([
      supabase.from("budget_revenue_lines").select("*").eq("budget_id", budgetId),
      supabase.from("budget_cost_lines").select("*").eq("budget_id", budgetId),
    ]);

    if (rev.error) {
      console.error("[GET /api/budget/[budgetId]] budget_revenue_lines:", rev.error.message, { budgetId });
      return NextResponse.json({ error: rev.error.message }, { status: 500 });
    }
    if (cost.error) {
      console.error("[GET /api/budget/[budgetId]] budget_cost_lines:", cost.error.message, { budgetId });
      return NextResponse.json({ error: cost.error.message }, { status: 500 });
    }

    const [hc, cx, occ] = await Promise.all([
      selectBudgetLinesOrEmpty(supabase, "budget_headcount_lines", budgetId),
      selectBudgetLinesOrEmpty(supabase, "budget_capex_lines", budgetId),
      selectBudgetLinesOrEmpty(supabase, "budget_occupancy_targets", budgetId),
    ]);

    return NextResponse.json({
      budget,
      revenueLines: rev.data ?? [],
      costLines: cost.data ?? [],
      headcountLines: hc,
      capexLines: cx,
      occupancyLines: occ,
    });
  } catch (e) {
    console.error("[GET /api/budget/[budgetId]] unhandled:", e);
    const msg = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { budgetId } = await ctx.params;
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { memberships } = await getMembershipContext(supabase, user.id);
    const { budget, error } = await loadBudget(supabase, budgetId);
    if (error) {
      console.error("[PATCH /api/budget/[budgetId]] loadBudget:", error, { budgetId });
      return NextResponse.json({ error }, { status: 500 });
    }
    if (!budget) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!userCanViewBudget(memberships, budget.tenant_id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: Partial<{
      name: string;
      status: string;
      notes: string | null;
      opening_cash_balance: number;
      budget_type: string;
      version_label: string | null;
      approved_at: string | null;
      approved_by: string | null;
    }>;
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name != null) patch.name = String(body.name).trim();
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.opening_cash_balance != null) patch.opening_cash_balance = Number(body.opening_cash_balance) || 0;
    if (body.budget_type != null) patch.budget_type = body.budget_type;
    if (body.version_label !== undefined) patch.version_label = body.version_label;
    if (body.status != null) {
      patch.status = body.status;
      if (body.status === "approved" || body.status === "active") {
        patch.approved_by = user.id;
        patch.approved_at = new Date().toISOString();
      }
    }

    const { data, error: uErr } = await supabase.from("budgets").update(patch).eq("id", budgetId).select("*").single();
    if (uErr) {
      console.error("[PATCH /api/budget/[budgetId]] update:", uErr.message, { budgetId });
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }
    return NextResponse.json({ budget: data });
  } catch (e) {
    console.error("[PATCH /api/budget/[budgetId]] unhandled:", e);
    const msg = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
