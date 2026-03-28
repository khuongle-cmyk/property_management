/** Row shape from GET /api/spaces/public (nested `properties` from Supabase). Safe for client + server (no `next/headers`). */
export type PublicBookableSpaceApiRow = {
  id: string;
  name: string;
  space_type: string;
  capacity: number | null;
  floor: string | null;
  room_number: string | null;
  hourly_price: number | null;
  size_m2?: number | null;
  space_status: string;
  is_published: boolean;
  requires_approval: boolean | null;
  amenity_projector?: boolean | null;
  amenity_whiteboard?: boolean | null;
  amenity_video_conferencing?: boolean | null;
  amenity_kitchen_access?: boolean | null;
  amenity_parking?: boolean | null;
  amenity_natural_light?: boolean | null;
  amenity_air_conditioning?: boolean | null;
  amenity_standing_desk?: boolean | null;
  amenity_phone_booth?: boolean | null;
  amenity_reception_service?: boolean | null;
  properties:
    | {
        id: string;
        name: string;
        address: string | null;
        postal_code: string | null;
        city: string | null;
      }
    | {
        id: string;
        name: string;
        address: string | null;
        postal_code: string | null;
        city: string | null;
      }[]
    | null;
};

export function apiRowPropertyName(row: PublicBookableSpaceApiRow): string {
  const p = row.properties;
  if (!p) return "";
  if (Array.isArray(p)) return p[0]?.name?.trim() ?? "";
  return p.name?.trim() ?? "";
}

export function apiRowPropertyId(row: PublicBookableSpaceApiRow): string {
  const p = row.properties;
  if (!p) return "";
  if (Array.isArray(p)) return p[0]?.id ?? "";
  return p.id ?? "";
}
