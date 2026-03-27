type PropertyLike = {
  id?: string | null;
  name?: string | null;
  city?: string | null;
  tenant_id?: string | null;
};

export function formatPropertyLabel(
  property: PropertyLike,
  opts?: {
    includeCity?: boolean;
    includeOrganization?: boolean;
    organizationNameById?: Map<string, string>;
  },
): string {
  const includeCity = opts?.includeCity !== false;
  const includeOrganization = !!opts?.includeOrganization;
  const base = property.name?.trim() || "Property";
  const city = includeCity && property.city?.trim() ? ` (${property.city.trim()})` : "";
  let organization = "";
  if (includeOrganization && property.tenant_id) {
    const name = opts?.organizationNameById?.get(property.tenant_id) ?? "Organization";
    organization = ` (${name})`;
  }
  return `${base}${city}${organization}`;
}

