import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Super admin only. Lists all properties for a tenant with tenant display name (bypasses RLS via service role).
 */
export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: mRows, error: mErr } = await supabase.from("memberships").select("role").eq("user_id", user.id);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  const isSuperAdmin = (mRows ?? []).some((m) => String(m.role ?? "").toLowerCase() === "super_admin");
  if (!isSuperAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const tenantId = new URL(req.url).searchParams.get("tenant_id")?.trim();
  if (!tenantId) {
    return NextResponse.json({ error: "tenant_id is required" }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from("properties")
      .select("id, name, tenant_id, tenants(name)")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true });

    if (error) {
      const { data: props, error: p2 } = await admin
        .from("properties")
        .select("id, name, tenant_id")
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true });
      if (p2) return NextResponse.json({ error: p2.message }, { status: 500 });
      const tids = [...new Set((props ?? []).map((p: { tenant_id: string }) => p.tenant_id))];
      const { data: tenants } = await admin.from("tenants").select("id, name").in("id", tids);
      const tmap = new Map((tenants ?? []).map((t: { id: string; name: string | null }) => [t.id, t.name]));
      const properties = ((props ?? []) as { id: string; name: string | null; tenant_id: string }[]).map((p) => {
        const tn = tmap.get(p.tenant_id) ?? null;
        const pname = p.name?.trim() || "—";
        const tname = tn?.trim() || "—";
        return {
          id: p.id,
          name: p.name,
          tenantName: tn,
          label: `${pname} (${tname})`,
        };
      });
      return NextResponse.json({ properties });
    }

    const properties = ((data ?? []) as unknown[]).map((row) => {
      const p = row as {
        id: string;
        name: string | null;
        tenant_id: string;
        tenants: { name: string | null } | { name: string | null }[] | null;
      };
      const tenantRel = p.tenants;
      const tenantOne = Array.isArray(tenantRel) ? tenantRel[0] : tenantRel;
      const pname = p.name?.trim() || "—";
      const tname = tenantOne?.name?.trim() || "—";
      return {
        id: p.id,
        name: p.name,
        tenantName: tenantOne?.name ?? null,
        label: `${pname} (${tname})`,
      };
    });

    return NextResponse.json({ properties });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json(
        { error: "Server missing SUPABASE_SERVICE_ROLE_KEY — cannot list properties for admin fees." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
