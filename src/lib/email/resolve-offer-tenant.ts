import type { SupabaseClient } from "@supabase/supabase-js";

/** Tenant for marketing_emails row when logging contract-tool sends. */
export async function resolveTenantIdForOfferCompany(
  admin: SupabaseClient,
  companyId: string | null | undefined,
): Promise<string | null> {
  if (!companyId) return null;
  const { data: c } = await admin.from("crm_contacts").select("tenant_id").eq("id", companyId).maybeSingle();
  const ct = (c as { tenant_id?: string | null } | null)?.tenant_id;
  if (ct) return ct;
  const { data: l } = await admin.from("leads").select("tenant_id").eq("id", companyId).maybeSingle();
  return (l as { tenant_id?: string | null } | null)?.tenant_id ?? null;
}

/** marketing_email_recipients.contact_id references public.leads(id). */
export async function leadIdForOfferCompany(
  admin: SupabaseClient,
  companyId: string | null | undefined,
): Promise<string | null> {
  if (!companyId) return null;
  const { data } = await admin.from("leads").select("id").eq("id", companyId).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
