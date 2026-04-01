/**
 * Next.js 16+: request interception lives in `src/proxy.ts` with a `proxy` export
 * (replaces the older `middleware.ts` file). Auth + route guards run here.
 */
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const userType = request.cookies.get("user_type")?.value;
  const appScope = request.cookies.get("app_scope")?.value;

  /** Preserve Supabase session + brand headers on redirects. */
  function redirectWithCookies(dest: URL) {
    const redirectRes = NextResponse.redirect(dest);
    supabaseResponse.cookies.getAll().forEach((c) => {
      redirectRes.cookies.set(c.name, c.value);
    });
    supabaseResponse.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith("x-brand")) {
        redirectRes.headers.set(key, value);
      }
    });
    return redirectRes;
  }

  const staffDashboardPaths =
    path.startsWith("/dashboard") ||
    path.startsWith("/super-admin") ||
    path.startsWith("/admin/") ||
    path === "/admin";

  if (path.startsWith("/portal") || path.startsWith("/customer-portal")) {
    if (!user) {
      const u = request.nextUrl.clone();
      u.pathname = "/login";
      u.searchParams.set("redirect", path);
      return redirectWithCookies(u);
    }
    if (userType !== "customer") {
      if (appScope === "dashboard") {
        return redirectWithCookies(new URL("/dashboard", request.url));
      }
      return redirectWithCookies(new URL("/bookings", request.url));
    }
  } else if (staffDashboardPaths) {
    if (!user) {
      const u = request.nextUrl.clone();
      u.pathname = "/login";
      return redirectWithCookies(u);
    }
    if (userType === "customer") {
      return redirectWithCookies(new URL("/portal", request.url));
    }
    if (userType === "admin" && appScope === "workspace") {
      return redirectWithCookies(new URL("/bookings", request.url));
    }
  } else if (path === "/login" && user) {
    if (userType === "customer") {
      return redirectWithCookies(new URL("/portal", request.url));
    }
    if (userType === "admin") {
      if (appScope === "dashboard") {
        return redirectWithCookies(new URL("/dashboard", request.url));
      }
      if (appScope === "workspace") {
        return redirectWithCookies(new URL("/bookings", request.url));
      }
      return redirectWithCookies(new URL("/dashboard", request.url));
    }
  }

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

