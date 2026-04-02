import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  applyMarketingRowScopeFilter,
  getMarketingAccess,
  resolveMarketingInsertTenantId,
  resolveMarketingTenantScope,
} from "@/lib/marketing/access";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "event";
}

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getMarketingAccess(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const resolved = await resolveMarketingTenantScope(supabase, url, { tenantIds, isSuperAdmin });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const filtered = applyMarketingRowScopeFilter(
    supabase.from("marketing_events").select("*").order("start_datetime", { ascending: false }).limit(200),
    resolved.scope,
  );

  const { data, error } = await filtered;
  if (error) {
    if (error.code === "42P01") return NextResponse.json({ events: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (data ?? []).map((e: { id: string }) => e.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    const { data: regs } = await supabase.from("marketing_event_registrations").select("event_id").in("event_id", ids);
    for (const r of regs ?? []) {
      const id = (r as { event_id: string }).event_id;
      counts[id] = (counts[id] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    events: (data ?? []).map((e: Record<string, unknown>) => ({
      ...e,
      _registration_count: counts[String(e.id)] ?? 0,
    })),
  });
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getMarketingAccess(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const resolvedT = resolveMarketingInsertTenantId(body, { tenantIds, isSuperAdmin });
  if (!resolvedT.ok) {
    return NextResponse.json({ error: resolvedT.error }, { status: resolvedT.status });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  let slug = String(body.slug ?? "").trim().toLowerCase();
  if (!slug) {
    slug = `${slugify(name)}-${randomBytes(3).toString("hex")}`;
  }

  const insert = {
    tenant_id: resolvedT.tenant_id,
    property_id: body.property_id ?? null,
    slug,
    name,
    description: body.description != null ? String(body.description) : null,
    event_type: String(body.event_type ?? "other"),
    start_datetime: body.start_datetime,
    end_datetime: body.end_datetime,
    location: body.location != null ? String(body.location) : null,
    max_attendees: body.max_attendees != null ? Number(body.max_attendees) : null,
    is_public: body.is_public !== false,
    registration_required: body.registration_required !== false,
    registration_deadline: body.registration_deadline ?? null,
    price: body.price != null ? Number(body.price) : 0,
    status: String(body.status ?? "draft"),
    cover_image_url: body.cover_image_url != null ? String(body.cover_image_url) : null,
  };

  const { data, error } = await supabase.from("marketing_events").insert(insert).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}
