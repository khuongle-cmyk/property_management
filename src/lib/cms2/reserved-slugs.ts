/**
 * First path segment must not be treated as a public org slug (avoids shadowing app routes).
 */
/**
 * Reserved first path segments (not org slugs).
 * Note: public marketing uses /book/*, /contact — do not reserve those here.
 */
export const CMS2_RESERVED_SLUGS = new Set([
  "api",
  "_next",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "manifest.json",
  "llms.txt",
  "dashboard",
  "login",
  "invite",
  "settings",
  "crm",
  "bookings",
  "reports",
  "rooms",
  "tasks",
  "profile",
  "super-admin",
  "admin",
  "properties",
  "meeting-rooms",
  "coworking",
  "offices",
  "venues",
  "virtual-office",
  "furniture",
  "billing",
  "budget",
  "marketing",
  "floor-plans",
  "tools",
]);

export function isReservedOrgSlug(slug: string): boolean {
  return CMS2_RESERVED_SLUGS.has(slug.toLowerCase());
}
