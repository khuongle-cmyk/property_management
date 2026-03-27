import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { DEFAULT_BRAND } from "@/lib/brand/default";
import { resolveBrandByHost } from "@/lib/brand/server";

export async function GET() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const brand = await resolveBrandByHost(host);
  return NextResponse.json({ ok: true, brand: brand ?? DEFAULT_BRAND });
}

