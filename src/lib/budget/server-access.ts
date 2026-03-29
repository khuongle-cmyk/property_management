import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMemberships, type MembershipRow } from "@/lib/reports/report-access";

export type BudgetRow = {
  id: string;
  tenant_id: string;
  property_id: string | null;
  /** property | administration | combined */
  budget_scope: string;
  name: string;
  budget_year: number;
  budget_type: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  opening_cash_balance: number | string | null;
  parent_budget_id: string | null;
  version_label: string | null;
};

export async function getMembershipContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ memberships: MembershipRow[]; canRunReports: boolean; canManageAny: boolean; tenantIds: string[] }> {
  const { data: mem } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", userId);
  const memberships = (mem ?? []) as MembershipRow[];
  const { canRunReports, scopedTenantIds } = normalizeMemberships(memberships);
  const roles = memberships.map((m) => (m.role ?? "").toLowerCase());
  const canManageAny = roles.some((r) =>
    ["super_admin", "owner", "manager"].includes(r),
  );
  return { memberships, canRunReports, canManageAny, tenantIds: scopedTenantIds };
}

export async function loadBudget(
  supabase: SupabaseClient,
  budgetId: string,
): Promise<{ budget: BudgetRow | null; error?: string }> {
  const { data, error } = await supabase.from("budgets").select("*").eq("id", budgetId).maybeSingle();
  if (error) return { budget: null, error: error.message };
  return { budget: data as BudgetRow | null };
}

export function userCanViewBudget(memberships: MembershipRow[], budgetTenantId: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  const { canRunReports, scopedTenantIds, isSuperAdmin } = normalizeMemberships(memberships);
  if (!canRunReports) return false;
  if (isSuperAdmin) return true;
  const want = norm(budgetTenantId);
  return scopedTenantIds.some((id) => norm(String(id)) === want);
}
