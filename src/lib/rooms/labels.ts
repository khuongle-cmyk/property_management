export const SPACE_TYPES = [
  "office",
  "conference_room",
  "venue",
  "hot_desk",
] as const;

export type SpaceType = (typeof SPACE_TYPES)[number];

export const ROOM_STATUSES = ["available", "occupied", "under_maintenance", "merged", "reserved"] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const AMENITY_KEYS = [
  { key: "amenity_projector", label: "Projector" },
  { key: "amenity_whiteboard", label: "Whiteboard" },
  { key: "amenity_video_conferencing", label: "Video conferencing" },
  { key: "amenity_kitchen_access", label: "Kitchen access" },
  { key: "amenity_parking", label: "Parking" },
  { key: "amenity_natural_light", label: "Natural light" },
  { key: "amenity_air_conditioning", label: "Air conditioning" },
  { key: "amenity_standing_desk", label: "Standing desk" },
  { key: "amenity_phone_booth", label: "Phone booth" },
  { key: "amenity_reception_service", label: "Reception service" },
] as const;

export function spaceTypeLabel(t: string): string {
  switch (t) {
    case "office":
      return "Office";
    case "conference_room":
      return "Conference room";
    case "venue":
      return "Venue";
    case "hot_desk":
      return "Hot desk";
    case "meeting_room":
      return "Conference room";
    case "desk":
      return "Hot desk";
    default:
      return t;
  }
}

export function spaceTypeBadgeStyle(t: string): { bg: string; fg: string; bd: string } {
  switch (t) {
    case "office":
      return { bg: "#e3f2fd", fg: "#0d47a1", bd: "#90caf9" };
    case "conference_room":
      return { bg: "#f3e5f5", fg: "#4a148c", bd: "#ce93d8" };
    case "venue":
      return { bg: "#e8f5e9", fg: "#1b5e20", bd: "#a5d6a7" };
    case "hot_desk":
      return { bg: "#fff8e1", fg: "#e65100", bd: "#ffcc80" };
    default:
      return { bg: "#f5f5f5", fg: "#424242", bd: "#e0e0e0" };
  }
}

export function roomStatusBadgeStyle(s: string): { bg: string; fg: string; bd: string } {
  switch (s) {
    case "available":
      return { bg: "#e6f6ea", fg: "#1b5e20", bd: "#b7e1bf" };
    case "occupied":
      return { bg: "#fff8e1", fg: "#e65100", bd: "#ffe082" };
    case "under_maintenance":
      return { bg: "#fbe8ea", fg: "#b00020", bd: "#f3b7be" };
    case "merged":
      return { bg: "#ede7f6", fg: "#4527a0", bd: "#b39ddb" };
    case "reserved":
      return { bg: "#e3f2fd", fg: "#0d47a1", bd: "#90caf9" };
    default:
      return { bg: "#f5f5f5", fg: "#424242", bd: "#e0e0e0" };
  }
}
