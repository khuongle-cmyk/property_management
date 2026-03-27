import type { SupabaseClient } from "@supabase/supabase-js";

export type ExportPropertyRow = {
  id: string;
  name: string | null;
  city: string | null;
  address: string | null;
  postal_code: string | null;
  total_units: number | null;
  occupied_units: number | null;
};

export type ReportExportContext = {
  properties: ExportPropertyRow[];
  generatedByEmail: string | null;
  generatedByUserId: string;
  brandName: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
};

function publicRoomPhotoUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/room-photos/${encoded}`;
}

export async function loadReportExportContext(
  supabase: SupabaseClient,
  allowedPropertyIds: string[],
  userId: string,
): Promise<ReportExportContext> {
  const brandName = process.env.REPORT_BRAND_NAME?.trim() || "Property Management";
  const logoUrl = process.env.REPORT_LOGO_URL?.trim() || null;

  const { data: props } = await supabase
    .from("properties")
    .select("id, name, city, address, postal_code, total_units, occupied_units")
    .in("id", allowedPropertyIds)
    .order("name", { ascending: true });

  const properties = (props ?? []) as ExportPropertyRow[];

  let generatedByEmail: string | null = null;
  const { data: urow } = await supabase.from("users").select("email").eq("id", userId).maybeSingle();
  if (urow && typeof (urow as { email?: string }).email === "string") {
    generatedByEmail = (urow as { email: string }).email;
  }

  let coverImageUrl: string | null = null;
  const primaryId = allowedPropertyIds[0];
  if (primaryId) {
    const { data: space } = await supabase
      .from("bookable_spaces")
      .select("id")
      .eq("property_id", primaryId)
      .limit(1)
      .maybeSingle();
    const sid = (space as { id?: string } | null)?.id;
    if (sid) {
      const { data: ph } = await supabase
        .from("room_photos")
        .select("storage_path")
        .eq("space_id", sid)
        .limit(1)
        .maybeSingle();
      const path = (ph as { storage_path?: string } | null)?.storage_path;
      if (path) coverImageUrl = publicRoomPhotoUrl(path);
    }
  }

  return {
    properties,
    generatedByEmail,
    generatedByUserId: userId,
    brandName,
    logoUrl,
    coverImageUrl,
  };
}

export function formatPropertyAddress(p: ExportPropertyRow): string {
  const parts = [p.address?.trim(), [p.postal_code?.trim(), p.city?.trim()].filter(Boolean).join(" ").trim()].filter(
    Boolean,
  );
  return parts.join(", ") || p.name || "—";
}
