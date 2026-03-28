import { slugify } from "@/lib/cms2/slug";
import { AMENITY_KEYS } from "@/lib/rooms/labels";
import type { PublicBookableSpaceApiRow } from "@/lib/spaces/public-spaces-shared";
import { apiRowPropertyId, apiRowPropertyName } from "@/lib/spaces/public-spaces-shared";

/** Tab / badge buckets aligned with marketing copy. */
export type SpaceTypeBucket = "office" | "meeting_room" | "hot_desk" | "venue";

export const SPACE_TYPE_BUCKETS: SpaceTypeBucket[] = ["office", "meeting_room", "hot_desk", "venue"];

const EROTTAJA2_CARD_IMAGE =
  "https://villageworks.com/wp-content/uploads/elementor/thumbs/Erottaja2-toimistoja2-r4r7vq99rp4w3gp75331jq75gxcpci1brh870x2lsg.webp";

const DEFAULT_PROPERTY_CARD_IMAGE =
  "https://villageworks.com/wp-content/uploads/2024/08/Toimistotilat-Helsinki-Erottaja2-Erottajankatu.webp";

function propertyRecord(row: PublicBookableSpaceApiRow): {
  id: string;
  name: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
} | null {
  const p = row.properties;
  if (!p) return null;
  if (Array.isArray(p)) return p[0] ?? null;
  return p;
}

export function formatPropertyAddress(row: PublicBookableSpaceApiRow): string {
  const p = propertyRecord(row);
  if (!p) return "";
  const parts = [p.address, [p.postal_code, p.city].filter(Boolean).join(" ")].filter(Boolean);
  return parts.join(", ");
}

export function propertyHeroImageUrl(propertyName: string): string {
  const n = propertyName.trim().toLowerCase();
  if (n.includes("erottaja2")) return EROTTAJA2_CARD_IMAGE;
  return DEFAULT_PROPERTY_CARD_IMAGE;
}

export function spaceTypeToBucket(spaceType: string): SpaceTypeBucket {
  const s = spaceType.toLowerCase();
  if (s === "office") return "office";
  if (s === "venue") return "venue";
  if (s === "hot_desk" || s === "desk") return "hot_desk";
  if (s === "meeting_room" || s === "conference_room") return "meeting_room";
  return "meeting_room";
}

export type PublicPropertyGroup = {
  propertyId: string;
  propertyName: string;
  addressLine: string;
  slug: string;
  cardImageUrl: string;
  spaces: PublicBookableSpaceApiRow[];
  counts: Record<SpaceTypeBucket, number>;
};

function emptyCounts(): Record<SpaceTypeBucket, number> {
  return { office: 0, meeting_room: 0, hot_desk: 0, venue: 0 };
}

export function groupPublicSpacesByProperty(rows: PublicBookableSpaceApiRow[]): PublicPropertyGroup[] {
  const map = new Map<string, PublicBookableSpaceApiRow[]>();
  for (const row of rows) {
    const pid = apiRowPropertyId(row);
    if (!pid) continue;
    const list = map.get(pid) ?? [];
    list.push(row);
    map.set(pid, list);
  }

  const groups: PublicPropertyGroup[] = [];
  for (const [, spaces] of map) {
    if (!spaces.length) continue;
    const first = spaces[0];
    const pr = propertyRecord(first);
    const propertyName = apiRowPropertyName(first) || pr?.name || "Property";
    const pid = apiRowPropertyId(first);
    const counts = emptyCounts();
    for (const s of spaces) {
      counts[spaceTypeToBucket(s.space_type)] += 1;
    }
    groups.push({
      propertyId: pid,
      propertyName,
      addressLine: formatPropertyAddress(first),
      slug: slugify(propertyName) || "location",
      cardImageUrl: propertyHeroImageUrl(propertyName),
      spaces,
      counts,
    });
  }

  groups.sort((a, b) => a.propertyName.localeCompare(b.propertyName, undefined, { sensitivity: "base" }));
  return groups;
}

export function findPropertyGroupBySlug(groups: PublicPropertyGroup[], segment: string): PublicPropertyGroup | null {
  const raw = decodeURIComponent(segment).trim().toLowerCase();
  if (!raw) return null;
  return groups.find((g) => g.slug.toLowerCase() === raw) ?? null;
}

export function parseTypeFilter(param: string | undefined): SpaceTypeBucket | "all" {
  if (!param || param === "all") return "all";
  const x = param.toLowerCase();
  if (x === "office" || x === "meeting_room" || x === "hot_desk" || x === "venue") return x;
  return "all";
}

/** Preserve `lang` and optional `type` for public CMS links. */
export function publicPageQuery(params: { lang?: string; type?: SpaceTypeBucket | "all" }): string {
  const p = new URLSearchParams();
  if (params.lang) p.set("lang", params.lang);
  if (params.type && params.type !== "all") p.set("type", params.type);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const AMENITY_ICON: Record<string, string> = {
  amenity_projector: "📽",
  amenity_whiteboard: "📝",
  amenity_video_conferencing: "📹",
  amenity_kitchen_access: "🍳",
  amenity_parking: "🅿️",
  amenity_natural_light: "☀️",
  amenity_air_conditioning: "❄️",
  amenity_standing_desk: "🧍",
  amenity_phone_booth: "📞",
  amenity_reception_service: "🏢",
};

/** Labels + icons for amenities that are true on the row (for public cards). */
export function activeAmenitiesForRow(row: PublicBookableSpaceApiRow): { key: string; icon: string; label: string }[] {
  const out: { key: string; icon: string; label: string }[] = [];
  for (const { key, label } of AMENITY_KEYS) {
    if (row[key as keyof PublicBookableSpaceApiRow] === true) {
      out.push({ key, icon: AMENITY_ICON[key] ?? "·", label });
    }
  }
  return out;
}
