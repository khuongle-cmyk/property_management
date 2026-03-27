import type { SupabaseClient } from "@supabase/supabase-js";

export const REPORT_READER_ROLES = new Set([
  "super_admin",
  "owner",
  "manager",
  "accounting",
  "viewer",
]);

export type MembershipRow = {
  tenant_id: string | null;
  role: string | null;
};

export function normalizeMemberships(rows: MembershipRow[]) {
  const roles = rows.map((r) => (r.role ?? "").toLowerCase());
  const isSuperAdmin = roles.includes("super_admin");
  const canRunReports = roles.some((r) => REPORT_READER_ROLES.has(r));
  /** Same breadth as rooms listing: any membership row tied to a tenant scopes properties. */
  const scopedTenantIds = [...new Set(rows.map((m) => m.tenant_id).filter(Boolean))] as string[];
  return { isSuperAdmin, canRunReports, scopedTenantIds, roles };
}

/**
 * Resolves which property UUIDs the user may include in a report.
 * When requestedIds is null/empty, returns all properties in scope.
 * Otherwise returns the intersection (invalid ids are dropped).
 */
export async function resolveAllowedPropertyIds(
  supabase: SupabaseClient,
  isSuperAdmin: boolean,
  scopedTenantIds: string[],
  requestedIds: string[] | null | undefined,
): Promise<{ allowedIds: string[]; error?: string }> {
  let baseQuery = supabase.from("properties").select("id").order("name", { ascending: true });

  if (!isSuperAdmin) {
    if (scopedTenantIds.length === 0) {
      return { allowedIds: [], error: "No tenant scope for reports" };
    }
    baseQuery = baseQuery.in("tenant_id", scopedTenantIds);
  }

  const { data, error } = await baseQuery;
  if (error) return { allowedIds: [], error: error.message };

  let ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (requestedIds && requestedIds.length > 0) {
    const wanted = new Set(requestedIds);
    ids = ids.filter((id) => wanted.has(id));
  }

  if (ids.length === 0) {
    return { allowedIds: [], error: "No properties match your selection or permissions" };
  }

  return { allowedIds: ids };
}
