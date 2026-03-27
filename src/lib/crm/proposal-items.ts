export type ProposalItemInput = {
  spaceId: string;
  proposedMonthlyRent?: number | null;
  proposedHourlyRate?: number | null;
  notes?: string | null;
};

export function sumProposalMonthlyRent(
  items: { proposed_monthly_rent?: number | string | null }[]
): number {
  return items.reduce((s, r) => s + (Number(r.proposed_monthly_rent) || 0), 0);
}

export function validateProposalItems(items: ProposalItemInput[] | undefined): string | null {
  if (!items?.length) return "At least one room line is required";
  for (const it of items) {
    const sid = it.spaceId?.trim();
    if (!sid) return "Each line needs a room";
    const m = it.proposedMonthlyRent != null ? Number(it.proposedMonthlyRent) : NaN;
    const h = it.proposedHourlyRate != null ? Number(it.proposedHourlyRate) : NaN;
    const hasM = it.proposedMonthlyRent != null && Number.isFinite(m) && m >= 0;
    const hasH = it.proposedHourlyRate != null && Number.isFinite(h) && h >= 0;
    if (!hasM && !hasH) return "Each room needs a monthly rent and/or hourly rate (≥ 0)";
  }
  return null;
}
