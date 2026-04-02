import { parseUuidOrNull } from "@/lib/uuid";

/**
 * Legacy clients sometimes stored email kind (e.g. "newsletter") in `campaign_id`.
 * `campaign_id` must be a real UUID or null; non-UUID strings belong in `campaign_type`.
 */
export function sanitizeMarketingEmailRow<T extends Record<string, unknown>>(row: T): T {
  const cid = row.campaign_id;
  if (cid == null || cid === "") {
    return { ...row, campaign_id: null } as T;
  }
  const uuid = parseUuidOrNull(cid);
  if (uuid) {
    return { ...row, campaign_id: uuid } as T;
  }
  const junk = String(cid).trim();
  const ctRaw = row.campaign_type;
  const ct = ctRaw != null && String(ctRaw).trim() !== "" ? String(ctRaw).trim() : junk;
  return {
    ...row,
    campaign_id: null,
    campaign_type: ct,
  } as T;
}
