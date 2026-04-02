/** GDPR-style display from first_name + last_name only (First L.). Not display_name/email. */
export function formatDisplayName(firstName: string, lastName: string): string {
  const capitalFirst = firstName
    ? firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()
    : "";
  const lastInitial = lastName ? " " + lastName.charAt(0).toUpperCase() + "." : "";
  return capitalFirst + lastInitial || "Member";
}

export type ShortProfile = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  /** Ignored for display — use first_name + last_name only */
  display_name?: string | null;
};

/** If last_name is empty but first_name looks like "khuong.le", split for display (view should use real columns). */
function splitCombinedLocalName(first: string, last: string): [string, string] {
  const f = first.trim();
  const l = last.trim();
  if (l || !f.includes(".")) return [f, l];
  const dot = f.indexOf(".");
  if (dot > 0 && dot < f.length - 1) {
    return [f.slice(0, dot), f.slice(dot + 1)];
  }
  return [f, l];
}

export function profileToDisplayName(row: ShortProfile | null | undefined): { name: string; initials: string } {
  if (!row) return { name: "Member", initials: "M" };
  let first = (row.first_name ?? "").trim();
  let last = (row.last_name ?? "").trim();
  [first, last] = splitCombinedLocalName(first, last);
  const name = formatDisplayName(first, last);
  const capFirst = first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : "";
  const initials = last
    ? (capFirst.charAt(0) || "") + last.charAt(0).toUpperCase()
    : capFirst.charAt(0) || "M";
  return { name, initials: initials || "M" };
}
