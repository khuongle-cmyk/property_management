import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_BRAND } from "@/lib/brand/default";
import { resolveBrandByTenantId } from "@/lib/brand/server";
import { createRoomPhotoSignedUrl } from "@/lib/storage/room-photo-signed-url";

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
  supportEmail: string | null;
  supportPhone: string | null;
  supportUrl: string | null;
};

export async function loadReportExportContext(
  supabase: SupabaseClient,
  allowedPropertyIds: string[],
  userId: string,
): Promise<ReportExportContext> {
  const { data: props } = await supabase
    .from("properties")
    .select("id, name, city, address, postal_code, total_units, occupied_units, tenant_id")
    .in("id", allowedPropertyIds)
    .order("name", { ascending: true });

  const properties = ((props ?? []) as Array<ExportPropertyRow & { tenant_id?: string | null }>).map((p) => ({
    id: p.id,
    name: p.name,
    city: p.city,
    address: p.address,
    postal_code: p.postal_code,
    total_units: p.total_units,
    occupied_units: p.occupied_units,
  }));
  const tenantId = ((props ?? []) as Array<{ tenant_id?: string | null }>)[0]?.tenant_id ?? null;
  const brand = tenantId ? await resolveBrandByTenantId(tenantId) : DEFAULT_BRAND;

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
      if (path) coverImageUrl = await createRoomPhotoSignedUrl(supabase, path);
    }
  }

  return {
    properties,
    generatedByEmail,
    generatedByUserId: userId,
    brandName: brand.brand_name,
    logoUrl: brand.logo_url,
    coverImageUrl,
    supportEmail: brand.support_email,
    supportPhone: brand.support_phone,
    supportUrl: brand.support_url,
  };
}

export function formatPropertyAddress(p: ExportPropertyRow): string {
  const parts = [p.address?.trim(), [p.postal_code?.trim(), p.city?.trim()].filter(Boolean).join(" ").trim()].filter(
    Boolean,
  );
  return parts.join(", ") || p.name || "—";
}
