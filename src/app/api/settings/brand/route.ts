import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_BRAND } from "@/lib/brand/default";
import type { BrandSettings, BrandPlan } from "@/lib/brand/types";

const OWNER_EDITABLE_FIELDS = new Set([
  "brand_name",
  "logo_url",
  "logo_white_url",
  "favicon_url",
  "primary_color",
  "secondary_color",
  "background_color",
  "sidebar_color",
  "text_color",
  "accent_color",
  "font_family",
  "login_page_headline",
  "login_page_subheadline",
  "login_page_background_image_url",
  "email_sender_name",
  "email_footer_text",
  "email_logo_url",
  "support_email",
  "support_phone",
  "support_url",
]);

type TenantMembership = { tenant_id: string | null; role: string | null };

async function getOwnerTenantAndPlan() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), supabase };
  const { data: memberships, error: mErr } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id);
  if (mErr) return { error: NextResponse.json({ error: mErr.message }, { status: 500 }), supabase };
  const ownerRow = (memberships ?? [])
    .map((m) => m as TenantMembership)
    .find((m) => ["owner", "manager", "super_admin"].includes(String(m.role ?? "").toLowerCase()) && m.tenant_id);
  if (!ownerRow?.tenant_id) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), supabase };

  const { data: tRow, error: tErr } = await supabase.from("tenants").select("id, plan").eq("id", ownerRow.tenant_id).maybeSingle();
  if (tErr) return { error: NextResponse.json({ error: tErr.message }, { status: 500 }), supabase };
  const plan = String((tRow as { plan?: string } | null)?.plan ?? "starter") as BrandPlan;
  return { error: null, supabase, tenantId: ownerRow.tenant_id, plan };
}

export async function GET() {
  const result = await getOwnerTenantAndPlan();
  if (result.error) return result.error;
  const { supabase, tenantId, plan } = result;
  const { data, error } = await supabase.from("brand_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error && error.code !== "42P01") return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, tenantId, plan, brand: (data ?? DEFAULT_BRAND) as BrandSettings });
}

export async function POST(req: Request) {
  const result = await getOwnerTenantAndPlan();
  if (result.error) return result.error;
  const { supabase, tenantId, plan } = result;
  if (plan === "starter") {
    return NextResponse.json(
      { error: "Branding is available on Professional and Enterprise plans.", upgradeRequired: true },
      { status: 402 },
    );
  }

  const raw = (await req.json()) as Record<string, unknown>;
  const payload: Record<string, unknown> = { tenant_id: tenantId, updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(raw)) {
    if (!OWNER_EDITABLE_FIELDS.has(k)) continue;
    payload[k] = v ?? null;
  }

  const { data, error } = await supabase
    .from("brand_settings")
    .upsert(
      {
        ...payload,
        brand_name: String(payload.brand_name ?? DEFAULT_BRAND.brand_name).trim() || DEFAULT_BRAND.brand_name,
      },
      { onConflict: "tenant_id" },
    )
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, brand: data, plan });
}

