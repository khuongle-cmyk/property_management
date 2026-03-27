import type { SupabaseClient } from "@supabase/supabase-js";

export type LeadAccessRow = { tenant_id: string; pipeline_owner: string };

/** Owner/manager of tenant pipeline, platform pipeline managers, or super_admin. */
export async function userCanManageLeadPipeline(
  supabase: SupabaseClient,
  userId: string,
  lead: LeadAccessRow
): Promise<boolean> {
  const { data: memberships } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", userId);

  const rows = (memberships ?? []) as { tenant_id: string | null; role: string | null }[];
  if (rows.some((r) => (r.role ?? "").toLowerCase() === "super_admin")) return true;

  if (lead.pipeline_owner === "platform") {
    return rows.some((r) => (r.role ?? "").toLowerCase() === "manager");
  }

  return rows.some(
    (r) =>
      r.tenant_id === lead.tenant_id &&
      lead.pipeline_owner === lead.tenant_id &&
      ["owner", "manager"].includes((r.role ?? "").toLowerCase())
  );
}
