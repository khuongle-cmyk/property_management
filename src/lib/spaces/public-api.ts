import { headers } from "next/headers";
import type { CmsPublicSpace } from "@/lib/cms2/types";
import type { PublicBookableSpaceApiRow } from "@/lib/spaces/public-spaces-shared";
import { apiRowPropertyId, apiRowPropertyName } from "@/lib/spaces/public-spaces-shared";

export type { PublicBookableSpaceApiRow } from "@/lib/spaces/public-spaces-shared";
export { apiRowPropertyId, apiRowPropertyName } from "@/lib/spaces/public-spaces-shared";

/** Base URL for server-side fetch to own `/api/*` (RSC / route handlers). Prefer env, then request Host, then Vercel. */
async function resolvePublicApiOrigin(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    if (host) return `${proto}://${host}`;
  } catch {
    /* not in a request context (e.g. build) */
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** Server-only: calls the public spaces API (used by RSC pages that need data before paint). */
export async function fetchPublicSpacesFromApi(): Promise<PublicBookableSpaceApiRow[]> {
  const base = await resolvePublicApiOrigin();
  try {
    const res = await fetch(`${base}/api/spaces/public`, { cache: "no-store" });
    const json = (await res.json()) as unknown;
    if (!res.ok) {
      console.warn("[fetchPublicSpacesFromApi] HTTP", res.status, json);
      return [];
    }
    if (json && typeof json === "object" && !Array.isArray(json) && "error" in json) {
      console.warn("[fetchPublicSpacesFromApi] error payload", json);
      return [];
    }
    return Array.isArray(json) ? (json as PublicBookableSpaceApiRow[]) : [];
  } catch (e) {
    console.warn("[fetchPublicSpacesFromApi]", e);
    return [];
  }
}

/** Map API row to the shape expected by booking UI (Cms2SpaceDetailClient). */
export function apiRowToCmsPublicSpace(row: PublicBookableSpaceApiRow): CmsPublicSpace {
  return {
    id: row.id,
    propertyId: apiRowPropertyId(row),
    propertyName: apiRowPropertyName(row),
    name: row.name,
    spaceType: row.space_type,
    hourlyPrice: Number(row.hourly_price) || 0,
    capacity: Number(row.capacity) || 1,
    requiresApproval: Boolean(row.requires_approval),
  };
}
