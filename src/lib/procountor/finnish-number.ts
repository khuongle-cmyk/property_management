/**
 * Parse Procountor / Finnish numeric strings (comma decimal, dot thousands).
 * Examples: "61816,23" → 61816.23, "1.234,56" → 1234.56, "-1255,18" → -1255.18
 * If there is no comma, the string is parsed as a plain decimal (e.g. JSON "1234.56").
 */
export function parseFinNumber(str: string): number {
  if (!str || str.trim() === "") return 0;
  let s = str.trim().replace(/\s+/g, "");
  const sign = s.startsWith("-") ? -1 : 1;
  if (s.startsWith("-")) s = s.slice(1);
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? sign * n : 0;
}
