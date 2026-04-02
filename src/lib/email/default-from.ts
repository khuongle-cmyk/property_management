/** Prefer the user's @villageworks.com address for outbound ERP mail. */
export function defaultVillageworksFromEmail(userEmail: string | null | undefined): string {
  const raw = (userEmail ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.endsWith("@villageworks.com")) return raw;
  const local = raw.split("@")[0] ?? "";
  if (!local) return "";
  return `${local}@villageworks.com`;
}
