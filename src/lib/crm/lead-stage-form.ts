/** Stage dropdown options for edit-lead UI (values match DB `leads.stage`). */
export const EDIT_LEAD_MODAL_STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "viewing", label: "Viewing" },
  { value: "offer", label: "Offer" },
  { value: "contract", label: "Contract" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

/** Map DB `leads.stage` → form select value */
export function leadStageColumnKeyFromDb(dbStage: string | null | undefined): string {
  const s = (dbStage || "new").toLowerCase();
  const map: Record<string, string> = {
    offer: "offer",
    contract: "contract",
    qualified: "viewing",
    proposal: "offer",
  };
  return map[s] ?? s;
}

/** Map form select value → DB `leads.stage` */
export function dbStageValueFromLeadForm(columnKey: string): string {
  const map: Record<string, string> = {
    offer: "offer",
    contract: "contract",
  };
  return map[columnKey] ?? columnKey;
}
