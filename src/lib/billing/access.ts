import type { SupabaseClient } from "@supabase/supabase-js";

export type MembershipScope = {
  userId: string;
  isSuperAdmin: boolean;
  tenantRoles: Array<{ tenant_id: string; role: string }>;
};

export async function getMembershipScope(supabase: SupabaseClient): Promise<MembershipScope | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id);
  const rawRoles = (data ?? []).map((m) => ({
    tenant_id: String(m.tenant_id ?? ""),
    role: String(m.role ?? "").toLowerCase(),
  }));
  const isSuperAdmin = rawRoles.some((m) => m.role === "super_admin");
  const tenantRoles = rawRoles.filter((m) => m.tenant_id);
  return {
    userId: user.id,
    isSuperAdmin,
    tenantRoles,
  };
}

export function firstManageableTenant(scope: MembershipScope): string | null {
  const row = scope.tenantRoles.find((r) => ["owner", "manager", "accounting", "super_admin"].includes(r.role));
  return row?.tenant_id ?? null;
}

export function canManageTenant(scope: MembershipScope, tenantId: string): boolean {
  if (scope.isSuperAdmin) return true;
  return scope.tenantRoles.some((r) => r.tenant_id === tenantId && ["owner", "manager", "accounting"].includes(r.role));
}

export function canViewTenant(scope: MembershipScope, tenantId: string): boolean {
  if (scope.isSuperAdmin) return true;
  return scope.tenantRoles.some((r) =>
    r.tenant_id === tenantId && ["owner", "manager", "accounting", "viewer"].includes(r.role),
  );
}

