import type { SupabaseClient } from "@supabase/supabase-js";

const READ_ROLES = new Set(["owner", "manager", "viewer", "accounting", "maintenance"]);
const WRITE_ROLES = new Set(["owner", "manager", "accounting"]);

export async function assertPropertyFinancialAccess(
  supabase: SupabaseClient,
  userId: string,
  propertyId: string,
  mode: "read" | "write",
): Promise<{ ok: boolean; error?: string; isSuperAdmin?: boolean }> {
  const { data: prop, error: pErr } = await supabase
    .from("properties")
    .select("tenant_id")
    .eq("id", propertyId)
    .maybeSingle();

  if (pErr) return { ok: false, error: pErr.message };
  if (!prop?.tenant_id) return { ok: false, error: "Property not found" };

  const { data: mems, error: mErr } = await supabase
    .from("memberships")
    .select("role, tenant_id")
    .eq("user_id", userId);

  if (mErr) return { ok: false, error: mErr.message };

  const rows = (mems ?? []) as { role: string | null; tenant_id: string | null }[];
  const isSuperAdmin = rows.some((r) => (r.role ?? "").toLowerCase() === "super_admin");
  if (isSuperAdmin) return { ok: true, isSuperAdmin: true };

  const rolesOnTenant = rows
    .filter((r) => r.tenant_id === prop.tenant_id)
    .map((r) => (r.role ?? "").toLowerCase());

  const need = mode === "write" ? WRITE_ROLES : READ_ROLES;
  if (!rolesOnTenant.some((r) => need.has(r))) {
    return { ok: false, error: "Forbidden" };
  }
  return { ok: true, isSuperAdmin: false };
}
