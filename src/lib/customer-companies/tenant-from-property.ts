/** Resolve tenant id from PostgREST-embedded `properties` on customer_companies. */
export function tenantIdFromCompanyPropertyJoin(
  properties:
    | { name?: string | null; tenant_id?: string | null }
    | { name?: string | null; tenant_id?: string | null }[]
    | null
    | undefined,
): string {
  if (!properties) return "";
  const row = Array.isArray(properties) ? properties[0] : properties;
  const tid = row?.tenant_id;
  return typeof tid === "string" ? tid : "";
}
