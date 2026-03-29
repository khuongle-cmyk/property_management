import type { SupabaseClient } from "@supabase/supabase-js";

export type ScopedPropertyRow = {
  id: string;
  name: string | null;
  city: string | null;
  tenant_id: string | null;
  address?: string | null;
  postal_code?: string | null;
  total_units?: number | null;
  occupied_units?: number | null;
  status?: string | null;
  /** Nested from `tenants` when selected with join (PostgREST may return object or single-element array) */
  tenants?: { name: string | null } | { name: string | null }[] | null;
};

export async function loadScopedPropertiesForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ properties: ScopedPropertyRow[]; isSuperAdmin: boolean; tenantIds: string[] }> {
  const { data: memberships } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", userId);

  const roleRows = (memberships ?? []).map((m) => ({
    tenant_id: String(m.tenant_id ?? ""),
    role: String(m.role ?? "").toLowerCase(),
  }));
  const isSuperAdmin = roleRows.some((m) => m.role === "super_admin");
  const tenantIds = [...new Set(roleRows.map((m) => m.tenant_id).filter(Boolean))];

  let q = supabase
    .from("properties")
    .select("id,name,city,tenant_id,address,postal_code,total_units,occupied_units,status,tenants(name)")
    .order("name", { ascending: true });
  if (!isSuperAdmin) {
    if (tenantIds.length === 0) return { properties: [], isSuperAdmin, tenantIds };
    q = q.in("tenant_id", tenantIds);
  }

  const { data } = await q;
  const raw = (data ?? []) as Record<string, unknown>[];
  const properties: ScopedPropertyRow[] = raw.map((row) => {
    const t = row.tenants;
    let tenants: ScopedPropertyRow["tenants"];
    if (t == null) tenants = null;
    else if (Array.isArray(t)) tenants = (t[0] as { name: string | null }) ?? null;
    else tenants = t as { name: string | null };
    return { ...row, tenants } as ScopedPropertyRow;
  });
  return {
    properties,
    isSuperAdmin,
    tenantIds,
  };
}

