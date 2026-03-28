import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

async function canListTenantUsers(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  tenantId: string
): Promise<boolean> {
  const { data: memberships, error } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", userId);

  if (error || !memberships?.length) return false;

  const rows = memberships as { tenant_id: string | null; role: string | null }[];
  if (rows.some((r) => (r.role ?? "").toLowerCase() === "super_admin")) {
    return true;
  }
  return rows.some(
    (r) =>
      r.tenant_id === tenantId && ["owner", "manager"].includes((r.role ?? "").toLowerCase())
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId")?.trim();
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowed = await canListTenantUsers(supabase, user.id, tenantId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server configuration missing";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const { data: memberships, error: mErr } = await admin
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", tenantId);

  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }

  const ids = [...new Set((memberships ?? []).map((m) => m.user_id).filter(Boolean))] as string[];
  if (ids.length === 0) {
    return NextResponse.json({ users: [] });
  }

  const { data: users, error: uErr } = await admin
    .from("users")
    .select("id, email, display_name")
    .in("id", ids)
    .order("email", { ascending: true });

  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  return NextResponse.json({ users: users ?? [] });
}
