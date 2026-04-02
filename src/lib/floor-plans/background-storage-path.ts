import type { SupabaseClient } from "@supabase/supabase-js";
import { FLOOR_PLANS_STORAGE_BUCKET } from "@/lib/floor-plans/storage-bucket";

/** Signed URL lifetime for floor-plan background images (seconds). */
export const FLOOR_PLAN_BACKGROUND_SIGNED_URL_EXPIRY = 3600;

/**
 * Resolves a stored value to the object path within `floor-plan-backgrounds`.
 * Accepts raw path, legacy public URL, or signed URL from the same bucket.
 */
export function floorPlanBackgroundObjectPath(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  const s = stored.trim();
  if (!s) return null;
  if (!s.includes("://")) {
    return s;
  }
  try {
    const u = new URL(s);
    const pathname = u.pathname;
    const publicSeg = `/object/public/${FLOOR_PLANS_STORAGE_BUCKET}/`;
    const signSeg = `/object/sign/${FLOOR_PLANS_STORAGE_BUCKET}/`;
    let idx = pathname.indexOf(publicSeg);
    if (idx >= 0) {
      return decodeURIComponent(pathname.slice(idx + publicSeg.length));
    }
    idx = pathname.indexOf(signSeg);
    if (idx >= 0) {
      return decodeURIComponent(pathname.slice(idx + signSeg.length));
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Persist storage path (or pass-through external URL) — never store expiring signed URLs. */
export function normalizeFloorPlanBackgroundForStorage(input: string | null): string | null {
  if (input == null || input === "") return null;
  const path = floorPlanBackgroundObjectPath(input);
  return path ?? input;
}

export async function resolveFloorPlanBackgroundUrlForClient(
  admin: SupabaseClient,
  stored: string | null,
  expiresIn = FLOOR_PLAN_BACKGROUND_SIGNED_URL_EXPIRY,
): Promise<string | null> {
  if (!stored) return null;
  const path = floorPlanBackgroundObjectPath(stored);
  if (!path) return stored;
  const { data, error } = await admin.storage.from(FLOOR_PLANS_STORAGE_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
