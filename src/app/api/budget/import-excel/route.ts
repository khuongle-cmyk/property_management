import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { budgetApiErrorPayload } from "@/lib/budget/api-errors";
import { getMembershipContext, userCanViewBudget } from "@/lib/budget/server-access";
import { normalizeMemberships } from "@/lib/reports/report-access";
import { parseVarjoAnnualWorkbook } from "@/lib/budget/varjobudjetti-grid-import";

const CHUNK = 400;

async function insertChunks(
  supabase: SupabaseClient,
  table: "budget_revenue_lines" | "budget_cost_lines",
  rows: Record<string, unknown>[],
): Promise<{ error?: string }> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).insert(slice);
    if (error) return { error: error.message };
  }
  return {};
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

  const form = await req.formData();
  const tenantId = String(form.get("tenantId") ?? "").trim();
  const file = form.get("file");
  const yearOverrideRaw = String(form.get("year") ?? "").trim();
  const yearOverride = yearOverrideRaw ? Number(yearOverrideRaw) : NaN;

  if (!tenantId || !(file instanceof Blob)) {
    return NextResponse.json({ error: "tenantId and file required" }, { status: 400 });
  }
  if (!userCanViewBudget(memberships, tenantId)) {
    return NextResponse.json({ error: "Forbidden for tenant" }, { status: 403 });
  }

  let propsQuery = supabase.from("properties").select("id,name").order("name", { ascending: true });
  if (!isSuperAdmin) {
    propsQuery = propsQuery.eq("tenant_id", tenantId);
  }
  const { data: props, error: pErr } = await propsQuery;
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  const properties = (props ?? []) as { id: string; name: string | null }[];
  if (properties.length === 0) {
    return NextResponse.json(
      {
        error: isSuperAdmin
          ? "No properties found in the database"
          : "No properties found for this tenant",
      },
      { status: 400 },
    );
  }

  const fileName = (file as File).name || "budget.xlsx";
  const ab = await file.arrayBuffer();
  const parsed = parseVarjoAnnualWorkbook(fileName, ab, properties);

  const year =
    Number.isFinite(yearOverride) && yearOverride >= 2000 && yearOverride <= 2100
      ? yearOverride
      : parsed.year;

  if (parsed.sheets.length === 0) {
    return NextResponse.json(
      {
        error: "No property sheets could be mapped to your properties",
        warnings: parsed.warnings,
        skippedSheets: parsed.skippedSheets,
      },
      { status: 400 },
    );
  }

  const name = `${year} Annual Budget`;

  const budgetRow = {
    tenant_id: tenantId,
    property_id: null as string | null,
    budget_scope: "combined" as const,
    name,
    budget_year: year,
    budget_type: "annual" as const,
    status: "draft" as const,
    notes: `Imported from ${fileName}`,
    created_by: user.id,
    opening_cash_balance: 0,
    parent_budget_id: null as string | null,
    version_label: null as string | null,
  };

  const { data: created, error: insErr } = await supabase.from("budgets").insert(budgetRow).select("*").single();
  if (insErr) {
    return NextResponse.json(budgetApiErrorPayload(insErr.message), { status: 500 });
  }
  const budget = created as { id: string };

  const revenueLines: Record<string, unknown>[] = [];
  const costLines: Record<string, unknown>[] = [];

  for (const s of parsed.sheets) {
    for (const r of s.revenueRows) {
      revenueLines.push({
        budget_id: budget.id,
        property_id: r.property_id,
        month: r.month,
        year,
        category: r.category,
        budgeted_amount: r.budgeted_amount,
      });
    }
    for (const c of s.costRows) {
      costLines.push({
        budget_id: budget.id,
        property_id: c.property_id,
        month: c.month,
        year,
        cost_type: c.cost_type,
        budgeted_amount: c.budgeted_amount,
      });
    }
  }

  if (revenueLines.length > 0) {
    const { error: rErr } = await insertChunks(supabase, "budget_revenue_lines", revenueLines);
    if (rErr) {
      await supabase.from("budgets").delete().eq("id", budget.id);
      return NextResponse.json({ error: rErr }, { status: 500 });
    }
  }
  if (costLines.length > 0) {
    const { error: cErr } = await insertChunks(supabase, "budget_cost_lines", costLines);
    if (cErr) {
      await supabase.from("budget_revenue_lines").delete().eq("budget_id", budget.id);
      await supabase.from("budgets").delete().eq("id", budget.id);
      return NextResponse.json({ error: cErr }, { status: 500 });
    }
  }

  await supabase.from("budgets").update({ updated_at: new Date().toISOString() }).eq("id", budget.id);

  const propertyCount = parsed.sheets.length;
  const summary = `Imported budget for ${propertyCount} properties, ${revenueLines.length} revenue lines, ${costLines.length} cost lines`;

  return NextResponse.json({
    ok: true,
    budget: created,
    propertiesImported: propertyCount,
    revenueLines: revenueLines.length,
    costLines: costLines.length,
    summary,
    year,
    warnings: parsed.warnings,
    skippedSheets: parsed.skippedSheets,
    sheets: parsed.sheets.map((s) => ({
      sheet: s.sheetName,
      propertyId: s.propertyId,
      propertyName: s.matchedPropertyName,
      revenueLines: s.revenueLineCount,
      costLines: s.costLineCount,
    })),
  });
}
