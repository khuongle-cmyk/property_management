import type { SupabaseClient } from "@supabase/supabase-js";

const CRM_EMAIL_ROLES = new Set([
  "super_admin",
  "owner",
  "manager",
  "agent",
  "customer_service",
  "accounting",
]);

/** Tenants where the user may send CRM one-to-one emails (stricter than viewer). */
export async function getCrmEmailTenantIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ tenantIds: string[]; isSuperAdmin: boolean; error?: string }> {
  const { data: mem, error } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", userId);
  if (error) return { tenantIds: [], isSuperAdmin: false, error: error.message };
  const rows = (mem ?? []) as { tenant_id: string | null; role: string | null }[];
  const isSuperAdmin = rows.some((m) => String(m.role ?? "").toLowerCase() === "super_admin");
  const tenantIds = [
    ...new Set(
      rows
        .filter((m) => CRM_EMAIL_ROLES.has(String(m.role ?? "").toLowerCase()))
        .map((m) => m.tenant_id)
        .filter(Boolean),
    ),
  ] as string[];
  return { tenantIds, isSuperAdmin };
}
