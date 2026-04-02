const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** Returns the string only if it is a valid UUID; otherwise null (never pass junk into UUID columns). */
export function parseUuidOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return UUID_RE.test(s) ? s : null;
}
