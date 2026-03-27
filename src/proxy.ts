import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const BRAND_CACHE_TTL_MS = 5 * 60 * 1000;
const brandDomainCache = new Map<string, { expiresAt: number; hit: boolean; brandName?: string }>();

function normalizeHost(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
}

async function detectBrandForHost(host: string): Promise<{ hit: boolean; brandName?: string }> {
  if (!host) return { hit: false };
  const cached = brandDomainCache.get(host);
  if (cached && cached.expiresAt > Date.now()) return { hit: cached.hit, brandName: cached.brandName };

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return { hit: false };

  try {
    const url =
      `${base}/rest/v1/brand_settings?select=brand_name` +
      `&custom_domain=eq.${encodeURIComponent(host)}` +
      `&is_active=eq.true` +
      `&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      cache: "no-store",
    });
    if (!res.ok) return { hit: false };
    const rows = (await res.json()) as Array<{ brand_name?: string }>;
    const row = rows[0];
    const out = { hit: !!row, brandName: row?.brand_name };
    brandDomainCache.set(host, { expiresAt: Date.now() + BRAND_CACHE_TTL_MS, ...out });
    return out;
  } catch {
    return { hit: false };
  }
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getUser();

  const host = normalizeHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  const brandDomain = await detectBrandForHost(host);
  if (host) supabaseResponse.headers.set("x-brand-host", host);
  supabaseResponse.headers.set("x-brand-hit", brandDomain.hit ? "1" : "0");
  if (brandDomain.brandName) supabaseResponse.headers.set("x-brand-name", brandDomain.brandName);

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

