import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canViewTenant, firstManageableTenant, getMembershipScope } from "@/lib/billing/access";
import { computePricingBreakdown, countTenantUsage, loadPlan, monthStartIso } from "@/lib/billing/pricing";

export async function GET(req: Request) {
  const supabase = createSupabaseServerClient();
  const scope = await getMembershipScope(supabase);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId")?.trim() || firstManageableTenant(scope);
  if (!tenantId) return NextResponse.json({ error: "No organization in scope" }, { status: 400 });
  if (!canViewTenant(scope, tenantId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .select("id,name,plan,trial_starts_at,trial_ends_at,trial_status,contact_email")
    .eq("id", tenantId)
    .maybeSingle();
  if (tErr || !tenant) return NextResponse.json({ error: tErr?.message ?? "Organization not found" }, { status: 404 });

  const planId = String((tenant as { plan?: string }).plan ?? "starter");
  const plan = await loadPlan(supabase, planId);
  if (!plan) return NextResponse.json({ error: "Pricing plan missing" }, { status: 500 });
  const usage = await countTenantUsage(supabase, tenantId);
  const billingMonth = monthStartIso();
  const trialEndsAt = String((tenant as { trial_ends_at?: string | null }).trial_ends_at ?? "");
  const trialStatus = String((tenant as { trial_status?: string | null }).trial_status ?? "none");
  const nowIso = new Date().toISOString();
  const inTrial = trialStatus === "active" && !!trialEndsAt && trialEndsAt > nowIso;

  const breakdown = computePricingBreakdown({
    plan,
    activeProperties: usage.properties,
    activeUsers: usage.users,
    billingMonth,
    inTrial,
  });
  const { data: invoices } = await supabase
    .from("manual_billing_invoices")
    .select("id,invoice_number,billing_month,due_date,status,total_amount,sent_at,paid_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(20);
  const openTotal = (invoices ?? [])
    .filter((x) => ["draft", "sent", "overdue"].includes(String((x as { status?: string }).status ?? "")))
    .reduce((s, x) => s + Number((x as { total_amount?: number }).total_amount ?? 0), 0);

  return NextResponse.json({
    ok: true,
    tenant,
    breakdown,
    openTotal,
    invoices: invoices ?? [],
    stripe: { enabled: false, status: "coming_soon" },
  });
}

