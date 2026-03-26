import type { SupabaseClient } from "@supabase/supabase-js";

/** Super admin, or owner/manager of the given tenant. */
export async function userCanManageRoomsForTenant(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string
): Promise<boolean> {
  const { data: memberships, error } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", userId);

  if (error || !memberships?.length) return false;

  const rows = memberships as { tenant_id: string | null; role: string | null }[];
  if (rows.some((r) => (r.role ?? "").toLowerCase() === "super_admin")) {
    return true;
  }
  return rows.some(
    (r) =>
      r.tenant_id === tenantId && ["owner", "manager"].includes((r.role ?? "").toLowerCase())
  );
}
