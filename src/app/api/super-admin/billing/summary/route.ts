import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMembershipScope } from "@/lib/billing/access";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const scope = await getMembershipScope(supabase);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!scope.isSuperAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [{ data: tenants }, { data: invoices }, { data: plans }] = await Promise.all([
    supabase.from("tenants").select("id,name,plan,trial_status,trial_ends_at").order("name", { ascending: true }),
    supabase
      .from("manual_billing_invoices")
      .select("id,tenant_id,invoice_number,status,total_amount,due_date,billing_month")
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("pricing_plans").select("*").order("display_name", { ascending: true }),
  ]);

  const byTenant = new Map<string, number>();
  for (const i of invoices ?? []) {
    const row = i as { tenant_id?: string | null; status?: string | null; total_amount?: number | null };
    if (!row.tenant_id) continue;
    if (!["draft", "sent", "overdue"].includes(String(row.status ?? ""))) continue;
    byTenant.set(row.tenant_id, (byTenant.get(row.tenant_id) ?? 0) + Number(row.total_amount ?? 0));
  }

  return NextResponse.json({
    ok: true,
    tenants: (tenants ?? []).map((t) => ({ ...t, outstanding_total: byTenant.get((t as { id: string }).id) ?? 0 })),
    invoices: invoices ?? [],
    plans: plans ?? [],
    stripe: { enabled: false, status: "coming_soon" },
  });
}

