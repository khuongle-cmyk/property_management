import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_BRAND } from "@/lib/brand/default";
import type { BrandSettings } from "@/lib/brand/types";

function normalizeDomain(input: unknown): string | null {
  const s = String(input ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return s || null;
}

async function requireSuperAdmin() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), supabase, user: null };
  const { data: mRows, error } = await supabase.from("memberships").select("role").eq("user_id", user.id);
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }), supabase, user: null };
  const isSuperAdmin = (mRows ?? []).some((m) => String(m.role ?? "").toLowerCase() === "super_admin");
  if (!isSuperAdmin) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), supabase, user: null };
  return { error: null, supabase, user };
}

export async function GET() {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const { data, error } = await supabase
    .from("brand_settings")
    .select("*, tenants(name)")
    .order("created_at", { ascending: false });
  if (error) {
    if (error.code === "42P01") return NextResponse.json({ ok: true, brands: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, brands: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth.error;
  const { supabase } = auth;
  const body = (await req.json()) as Partial<BrandSettings> & { tenant_id?: string };
  const tenantId = String(body.tenant_id ?? "").trim();
  if (!tenantId) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });
  const { data: tRow, error: tErr } = await supabase.from("tenants").select("plan").eq("id", tenantId).maybeSingle();
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  const plan = String((tRow as { plan?: string } | null)?.plan ?? "starter");
  if (plan === "starter") {
    return NextResponse.json({ error: "Starter plan cannot use white-label branding." }, { status: 402 });
  }
  if (plan !== "enterprise" && body.custom_domain) {
    return NextResponse.json({ error: "Custom domain requires Enterprise plan." }, { status: 402 });
  }

  const payload = {
    tenant_id: tenantId,
    brand_name: String(body.brand_name ?? DEFAULT_BRAND.brand_name).trim() || DEFAULT_BRAND.brand_name,
    custom_domain: plan === "enterprise" ? normalizeDomain(body.custom_domain) : null,
    logo_url: body.logo_url ?? null,
    logo_white_url: body.logo_white_url ?? null,
    favicon_url: body.favicon_url ?? null,
    primary_color: body.primary_color ?? DEFAULT_BRAND.primary_color,
    secondary_color: body.secondary_color ?? DEFAULT_BRAND.secondary_color,
    background_color: body.background_color ?? DEFAULT_BRAND.background_color,
    sidebar_color: body.sidebar_color ?? DEFAULT_BRAND.sidebar_color,
    text_color: body.text_color ?? DEFAULT_BRAND.text_color,
    accent_color: body.accent_color ?? DEFAULT_BRAND.accent_color,
    font_family: body.font_family ?? null,
    login_page_headline: body.login_page_headline ?? null,
    login_page_subheadline: body.login_page_subheadline ?? null,
    login_page_background_image_url: body.login_page_background_image_url ?? null,
    email_sender_name: body.email_sender_name ?? null,
    email_sender_address: body.email_sender_address ?? null,
    email_footer_text: body.email_footer_text ?? null,
    email_logo_url: body.email_logo_url ?? null,
    support_email: body.support_email ?? null,
    support_phone: body.support_phone ?? null,
    support_url: body.support_url ?? null,
    hide_powered_by: plan === "enterprise" ? (body.hide_powered_by ?? false) : false,
    powered_by_text: body.powered_by_text ?? DEFAULT_BRAND.powered_by_text,
    is_active: body.is_active ?? true,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("brand_settings")
    .upsert(payload, { onConflict: "tenant_id" })
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, brand: data });
}

