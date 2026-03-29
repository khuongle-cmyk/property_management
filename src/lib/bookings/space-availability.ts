/** Status values that allow hourly / calendar bookings (legacy + rooms upgrade). */
export const HOURLY_BOOKABLE_SPACE_STATUSES = ["available", "vacant"] as const;

export function isHourlyBookableSpaceStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase().trim();
  return s === "available" || s === "vacant";
}

/** Treat null/undefined as published (older rows). */
export function isSpacePublishedForBooking(isPublished: boolean | null | undefined): boolean {
  return isPublished !== false;
}

/** Normalize CMS / import variants ("Meeting Room", "conference_room") for filter matching. */
export function normalizeSpaceTypeKey(spaceType: string | null | undefined): string {
  return (spaceType ?? "").toLowerCase().trim().replace(/\s+/g, "_").replace(/-/g, "_");
}
