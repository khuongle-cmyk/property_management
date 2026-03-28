import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_BRAND } from "@/lib/brand/default";
import type { BrandSettings } from "@/lib/brand/types";

const HOST_CACHE_TTL_MS = 5 * 60 * 1000;
const hostCache = new Map<string, { expiresAt: number; brand: BrandSettings }>();

function normalizeHost(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
}

function sanitizeBrand(input: Partial<BrandSettings> | null | undefined): BrandSettings {
  const b = input ?? {};
  return {
    ...DEFAULT_BRAND,
    ...b,
    brand_name: (b.brand_name ?? DEFAULT_BRAND.brand_name).trim() || DEFAULT_BRAND.brand_name,
    custom_domain: b.custom_domain ? normalizeHost(b.custom_domain) : null,
    hide_powered_by: !!b.hide_powered_by,
    powered_by_text: (b.powered_by_text ?? DEFAULT_BRAND.powered_by_text).trim() || DEFAULT_BRAND.powered_by_text,
  };
}

export async function resolveBrandByHost(hostRaw: string | null | undefined): Promise<BrandSettings> {
  const host = normalizeHost(hostRaw);
  if (!host) return DEFAULT_BRAND;
  const cached = hostCache.get(host);
  if (cached && cached.expiresAt > Date.now()) return cached.brand;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("brand_settings")
    .select("*")
    .eq("custom_domain", host)
    .eq("is_active", true)
    .maybeSingle();

  if (error && error.code !== "42P01") return DEFAULT_BRAND;
  const brand = sanitizeBrand((data as Partial<BrandSettings> | null) ?? null);
  hostCache.set(host, { expiresAt: Date.now() + HOST_CACHE_TTL_MS, brand });
  return brand;
}

export async function resolveBrandByTenantId(tenantId: string | null | undefined): Promise<BrandSettings> {
  if (!tenantId) return DEFAULT_BRAND;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("brand_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .maybeSingle();
  if (error && error.code !== "42P01") return DEFAULT_BRAND;
  return sanitizeBrand((data as Partial<BrandSettings> | null) ?? null);
}

export function brandEmailFrom(brand: BrandSettings, fallback: string): string {
  const senderName = (brand.email_sender_name ?? "").trim();
  const senderAddress = (brand.email_sender_address ?? "").trim();
  if (senderName && senderAddress) return `${senderName} <${senderAddress}>`;
  if (senderAddress) return senderAddress;
  return fallback;
}

