import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canViewTenant, firstManageableTenant, getMembershipScope } from "@/lib/billing/access";
import { computePricingBreakdown, countTenantUsage, loadPlan, monthStartIso } from "@/lib/billing/pricing";

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const scope = await getMembershipScope(supabase);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as { tenantId?: string; billingMonth?: string };
  const tenantId = body.tenantId?.trim() || firstManageableTenant(scope);
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
  if (!plan) return NextResponse.json({ error: `Plan ${planId} not configured` }, { status: 500 });
  const usage = await countTenantUsage(supabase, tenantId);
  const billingMonth = (body.billingMonth ?? monthStartIso()).slice(0, 10);

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
  return NextResponse.json({
    ok: true,
    tenant: {
      id: (tenant as { id: string }).id,
      name: (tenant as { name?: string | null }).name ?? "Organization",
      plan: planId,
      trial_status: trialStatus,
      trial_ends_at: trialEndsAt || null,
      recipient_email: (tenant as { contact_email?: string | null }).contact_email ?? null,
    },
    breakdown,
  });
}

