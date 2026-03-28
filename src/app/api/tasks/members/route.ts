import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const taskId = (url.searchParams.get("taskId") ?? "").trim();
  const tenantIdsRaw = (url.searchParams.get("tenantIds") ?? "").trim();
  const tenantIds = tenantIdsRaw
    ? [...new Set(tenantIdsRaw.split(",").map((x) => x.trim()).filter(Boolean))]
    : [];
  const { data: selfMemberships } = await supabase.from("memberships").select("role").eq("user_id", user.id);
  const isSuperAdmin = (selfMemberships ?? []).some((m) => String(m.role ?? "").toLowerCase() === "super_admin");
  if (!taskId && !tenantIds.length && !isSuperAdmin) {
    return NextResponse.json({ error: "taskId or tenantIds required" }, { status: 400 });
  }

  let scopedTenantIds = tenantIds;
  if (!scopedTenantIds.length && isSuperAdmin) {
    const { data: allMemberships } = await supabase.from("memberships").select("tenant_id");
    scopedTenantIds = [...new Set((allMemberships ?? []).map((m) => String(m.tenant_id ?? "")).filter(Boolean))];
  }
  if (!scopedTenantIds.length) {
    const { data: task } = await supabase.from("client_tasks").select("tenant_id").eq("id", taskId).maybeSingle();
    if (!task?.tenant_id) return NextResponse.json({ members: [] });
    scopedTenantIds = [task.tenant_id];
  }
  const { data: members } = await supabase
    .from("memberships")
    .select("user_id,role,tenant_id")
    .in("tenant_id", scopedTenantIds);
  const admin = getSupabaseAdminClient();
  const uniqueUserIds = [...new Set((members ?? []).map((m) => String(m.user_id ?? "")).filter(Boolean))];
  const profileByUserId = new Map<string, { name: string; email: string }>();
  for (const uid of uniqueUserIds) {
    const u = await admin.auth.admin.getUserById(uid);
    const meta = u.data.user?.user_metadata as { full_name?: string; name?: string } | undefined;
    const name = String(meta?.full_name ?? meta?.name ?? "").trim();
    const email = String(u.data.user?.email ?? "").trim();
    profileByUserId.set(uid, { name, email });
  }
  const out = await Promise.all(
    (members ?? []).map(async (m) => {
      const uid = String(m.user_id ?? "");
      const profile = profileByUserId.get(uid) ?? { name: "", email: "" };
      const name = profile.name;
      const email = profile.email;
      const display = name || email || `${uid.slice(0, 8)}…`;
      return {
        user_id: uid,
        tenant_id: m.tenant_id,
        role: m.role,
        name: display,
        label: `${display} (${String(m.role ?? "member")})`,
      };
    }),
  );
  return NextResponse.json({ members: out });
}

