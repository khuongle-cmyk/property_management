import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { DEFAULT_BRAND } from "@/lib/brand/default";
import { resolveBrandByHost } from "@/lib/brand/server";
import type { BrandSettings } from "@/lib/brand/types";

/** Minimal VillageWorks fallback (subset of BrandSettings) merged into full default on errors. */
const FALLBACK_BRAND: BrandSettings = {
  ...DEFAULT_BRAND,
  brand_name: "VillageWorks",
  logo_url: "https://villageworks.com/wp-content/uploads/2020/07/VillageWorks-Logo-Petrol-768x96.png",
  logo_white_url: "https://villageworks.com/wp-content/uploads/2022/10/VillageWorks-Logo-white-768x96.webp",
  primary_color: "#1a5c5a",
  secondary_color: "#2d8b87",
  sidebar_color: "#0d3d3b",
  background_color: "#f8fafa",
};

function jsonSuccess(brand: BrandSettings) {
  return NextResponse.json({ ok: true, brand }, { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
}

export async function GET() {
  try {
    await cookies();
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    const brand = await resolveBrandByHost(host);
    return jsonSuccess(brand ?? FALLBACK_BRAND);
  } catch (e) {
    console.error("[api/brand/current]", e);
    return jsonSuccess(FALLBACK_BRAND);
  }
}
