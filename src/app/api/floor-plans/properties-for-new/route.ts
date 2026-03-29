import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Properties for floor plan create form. Super admins get all properties (service role when configured).
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: mem, error: mErr } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const rows = (mem ?? []) as { tenant_id: string | null; role: string | null }[];
  const isSuperAdmin = rows.some((r) => String(r.role ?? "").toLowerCase() === "super_admin");

  if (isSuperAdmin) {
    try {
      const admin = getSupabaseAdminClient();
      const { data, error } = await admin.from("properties").select("id, name, tenant_id").order("name", { ascending: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ properties: data ?? [] });
    } catch {
      /* no service key — fall through to RLS-scoped read */
    }
    const { data, error } = await supabase.from("properties").select("id, name, tenant_id").order("name", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ properties: data ?? [] });
  }

  const tenantIds = [...new Set(rows.map((r) => r.tenant_id).filter(Boolean))] as string[];
  if (tenantIds.length === 0) {
    return NextResponse.json({ properties: [] });
  }
  const { data, error } = await supabase
    .from("properties")
    .select("id, name, tenant_id")
    .in("tenant_id", tenantIds)
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ properties: data ?? [] });
}
