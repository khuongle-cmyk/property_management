import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PipelineSettingsPayload = {
  tenantId?: string;
  enabled?: boolean;
  contactSlug?: string | null;
  inboundEmail?: string | null;
  customStages?: string[] | null;
  autoAssignRules?: Record<string, unknown> | null;
};

function normalizeSlug(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  return v.replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

async function canManageTenant(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  userId: string,
  tenantId: string
): Promise<boolean> {
  const { data: memberships } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", userId);
  const rows = (memberships ?? []) as { tenant_id: string | null; role: string | null }[];
  return rows.some((m) => {
    const role = (m.role ?? "").toLowerCase();
    return role === "super_admin" || (m.tenant_id === tenantId && (role === "owner" || role === "manager"));
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId")?.trim();
  if (!tenantId) return NextResponse.json({ error: "tenantId is required" }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const allowed = await canManageTenant(supabase, user.id, tenantId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase.from("crm_pipeline_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ settings: data ?? null });
}

export async function POST(req: Request) {
  let body: PipelineSettingsPayload;
  try {
    body = (await req.json()) as PipelineSettingsPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const tenantId = (body.tenantId ?? "").trim();
  if (!tenantId) return NextResponse.json({ error: "tenantId is required" }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const allowed = await canManageTenant(supabase, user.id, tenantId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const payload = {
    tenant_id: tenantId,
    enabled: !!body.enabled,
    contact_slug: normalizeSlug(body.contactSlug),
    inbound_email: (body.inboundEmail ?? "").trim().toLowerCase() || null,
    custom_stages: Array.isArray(body.customStages) && body.customStages.length ? body.customStages : null,
    auto_assign_rules: body.autoAssignRules ?? {},
  };

  const { data, error } = await supabase.from("crm_pipeline_settings").upsert(payload).select("*").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, settings: data });
}

