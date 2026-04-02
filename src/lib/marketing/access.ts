import type { SupabaseClient } from "@supabase/supabase-js";

const MARKETING_ROLES = new Set([
  "owner",
  "manager",
  "customer_service",
  "accounting",
  "viewer",
  "agent",
  "super_admin",
]);

export async function getMarketingAccess(
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
        .filter((m) => MARKETING_ROLES.has(String(m.role ?? "").toLowerCase()))
        .map((m) => m.tenant_id)
        .filter(Boolean),
    ),
  ] as string[];
  return { tenantIds, isSuperAdmin };
}

/** @deprecated Prefer resolveMarketingTenantScope for marketing list APIs */
export function parseTenantIdParam(url: URL, tenantIds: string[]): string | null {
  const raw = (url.searchParams.get("tenantId") ?? "").trim();
  if (!raw) return tenantIds.length === 1 ? tenantIds[0] : null;
  if (!tenantIds.includes(raw)) return null;
  return raw;
}

export type MarketingTenantScope =
  | { kind: "all"; tenantIds: string[] }
  | { kind: "single"; tenantId: string };

export type ResolveMarketingTenantScopeResult =
  | { ok: true; scope: MarketingTenantScope }
  | { ok: false; error: string; status: number };

/**
 * Resolves tenant filter for marketing GET APIs.
 * Super admin: `allOrganizations=1` or no tenantId → all tenants; explicit `tenantId` → one tenant.
 * Others: never all-tenants; tenantId from query or implied when exactly one membership tenant.
 */
export async function resolveMarketingTenantScope(
  supabase: SupabaseClient,
  url: URL,
  access: { tenantIds: string[]; isSuperAdmin: boolean },
): Promise<ResolveMarketingTenantScopeResult> {
  const allOrg = url.searchParams.get("allOrganizations") === "1";
  const raw = (url.searchParams.get("tenantId") ?? "").trim();

  const { data: tenantRows, error: tErr } = await supabase.from("tenants").select("id");
  if (tErr) return { ok: false, error: tErr.message, status: 500 };
  const everyTenantId = ((tenantRows ?? []) as { id: string }[]).map((r) => r.id);

  if (access.isSuperAdmin) {
    if (allOrg) {
      return { ok: true, scope: { kind: "all", tenantIds: everyTenantId } };
    }
    if (raw) {
      if (!everyTenantId.includes(raw)) {
        return { ok: false, error: "Invalid tenantId", status: 400 };
      }
      return { ok: true, scope: { kind: "single", tenantId: raw } };
    }
    return { ok: true, scope: { kind: "all", tenantIds: everyTenantId } };
  }

  if (allOrg) {
    if (access.tenantIds.length === 0) {
      return { ok: false, error: "Forbidden", status: 403 };
    }
    return { ok: true, scope: { kind: "all", tenantIds: access.tenantIds } };
  }

  let tid = raw;
  if (!tid && access.tenantIds.length === 1) {
    tid = access.tenantIds[0];
  }
  if (!tid || !access.tenantIds.includes(tid)) {
    return { ok: false, error: "tenantId required", status: 400 };
  }
  return { ok: true, scope: { kind: "single", tenantId: tid } };
}

export function marketingScopeTenantIds(scope: MarketingTenantScope): string[] {
  return scope.kind === "single" ? [scope.tenantId] : scope.tenantIds;
}

export function marketingResponseTenantKey(scope: MarketingTenantScope): string {
  return scope.kind === "single" ? scope.tenantId : "all";
}

/** Returns null when there are no tenant ids to filter (empty org list). */
export function applyMarketingTenantIdsFilter<
  T extends { eq: (column: string, value: string) => T; in: (column: string, values: string[]) => T },
>(q: T, scopeIds: string[]): T | null {
  if (scopeIds.length === 0) return null;
  if (scopeIds.length === 1) return q.eq("tenant_id", scopeIds[0]);
  return q.in("tenant_id", scopeIds);
}

/** PostgREST OR: scoped tenants OR global rows (tenant_id IS NULL). */
export function marketingRowScopeOrFilter(scope: MarketingTenantScope): string {
  const ids = marketingScopeTenantIds(scope);
  const nullPart = "tenant_id.is.null";
  if (ids.length === 0) return nullPart;
  if (ids.length === 1) return `tenant_id.eq.${ids[0]},${nullPart}`;
  return `tenant_id.in.(${ids.join(",")}),${nullPart}`;
}

/** List APIs: rows for selected org(s) plus organization-wide (NULL tenant_id) rows. */
export function applyMarketingRowScopeFilter<T extends { or: (filter: string) => T }>(
  q: T,
  scope: MarketingTenantScope,
): T {
  return q.or(marketingRowScopeOrFilter(scope));
}

/** Row-level access for PATCH/GET when tenant_id may be NULL (global marketing row). */
export function canAccessMarketingRowByTenantId(
  rowTenantId: string | null | undefined,
  access: { tenantIds: string[]; isSuperAdmin: boolean },
): boolean {
  if (access.isSuperAdmin) return true;
  if (rowTenantId == null || rowTenantId === "") {
    return access.tenantIds.length > 0;
  }
  return access.tenantIds.includes(rowTenantId);
}

export type ResolveMarketingInsertTenantResult =
  | { ok: true; tenant_id: string | null }
  | { ok: false; error: string; status: number };

/**
 * POST bodies: pass allOrganizations: true (and omit tenantId) for a global row (tenant_id NULL).
 * With allOrganizations true and tenantId set, uses that specific tenant.
 */
export function resolveMarketingInsertTenantId(
  body: Record<string, unknown>,
  access: { tenantIds: string[]; isSuperAdmin: boolean },
): ResolveMarketingInsertTenantResult {
  const allOrg =
    body.allOrganizations === true ||
    body.all_organizations === true;

  const raw = body.tenant_id ?? body.tenantId;
  const explicit = raw === null || raw === undefined ? "" : String(raw).trim();

  if (allOrg) {
    if (!explicit) {
      return { ok: true, tenant_id: null };
    }
    if (!access.isSuperAdmin && !access.tenantIds.includes(explicit)) {
      return { ok: false, error: "Invalid tenant", status: 400 };
    }
    return { ok: true, tenant_id: explicit };
  }

  if (!explicit) {
    return { ok: false, error: "tenantId required", status: 400 };
  }
  if (!access.isSuperAdmin && !access.tenantIds.includes(explicit)) {
    return { ok: false, error: "Invalid tenant", status: 400 };
  }
  return { ok: true, tenant_id: explicit };
}

/** Leads queries for emails/SMS whose campaign row has NULL tenant_id (all orgs). */
export async function marketingLeadTenantIdsForEmail(
  supabase: SupabaseClient,
  emailTenantId: string | null,
  access: { tenantIds: string[]; isSuperAdmin: boolean },
): Promise<string[]> {
  if (emailTenantId) return [emailTenantId];
  if (access.isSuperAdmin) {
    const { data, error } = await supabase.from("tenants").select("id");
    if (error) return [];
    return ((data ?? []) as { id: string }[]).map((r) => r.id);
  }
  return access.tenantIds;
}

/** Append `?tenantId=` or `?allOrganizations=1` to a path that may already have a query string. */
export function pathWithMarketingScope(path: string, querySuffix: string): string {
  if (!querySuffix) return path;
  const q = querySuffix.startsWith("?") ? querySuffix.slice(1) : querySuffix;
  return path.includes("?") ? `${path}&${q}` : `${path}?${q}`;
}
