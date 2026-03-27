import type { SupabaseClient } from "@supabase/supabase-js";

export type ScopedPropertyRow = {
  id: string;
  name: string | null;
  city: string | null;
  tenant_id: string | null;
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

  let q = supabase.from("properties").select("id,name,city,tenant_id").order("name", { ascending: true });
  if (!isSuperAdmin) {
    if (tenantIds.length === 0) return { properties: [], isSuperAdmin, tenantIds };
    q = q.in("tenant_id", tenantIds);
  }

  const { data } = await q;
  return {
    properties: ((data ?? []) as ScopedPropertyRow[]) ?? [],
    isSuperAdmin,
    tenantIds,
  };
}

