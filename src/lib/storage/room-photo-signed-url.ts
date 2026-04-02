import type { SupabaseClient } from "@supabase/supabase-js";

/** Default expiry for signed room photo URLs (seconds). */
export const ROOM_PHOTO_SIGNED_URL_EXPIRY = 3600;

export async function createRoomPhotoSignedUrl(
  supabase: SupabaseClient,
  storagePath: string,
  expiresIn = ROOM_PHOTO_SIGNED_URL_EXPIRY,
): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from("room-photos").createSignedUrl(storagePath, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** One signed URL per unique storage path (same path → same key). */
export async function createRoomPhotoSignedUrlMap(
  supabase: SupabaseClient,
  storagePaths: string[],
  expiresIn = ROOM_PHOTO_SIGNED_URL_EXPIRY,
): Promise<Map<string, string>> {
  const unique = [...new Set(storagePaths.filter(Boolean))];
  const map = new Map<string, string>();
  await Promise.all(
    unique.map(async (path) => {
      const url = await createRoomPhotoSignedUrl(supabase, path, expiresIn);
      if (url) map.set(path, url);
    }),
  );
  return map;
}
