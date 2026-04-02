import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type Body = {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  companyId?: string;
  role?: string;
};

async function assertCanManageCompany(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  companyId: string,
): Promise<boolean> {
  const { data: mems } = await supabase.from("memberships").select("role, tenant_id").eq("user_id", userId);
  const rows = (mems ?? []) as { role: string | null; tenant_id: string | null }[];
  const roles = rows.map((m) => (m.role ?? "").toLowerCase());
  if (roles.includes("super_admin")) return true;

  const { data: cc } = await supabase
    .from("customer_companies")
    .select("property_id, properties(tenant_id)")
    .eq("id", companyId)
    .maybeSingle();
  const cr = cc as { property_id?: string | null; properties?: { tenant_id?: string } | { tenant_id?: string }[] | null } | null;
  const prop = cr?.properties;
  const propRow = Array.isArray(prop) ? prop[0] : prop;
  const tenantId = propRow?.tenant_id ?? null;
  if (!tenantId) return false;

  const staffOk = rows.some(
    (m) =>
      m.tenant_id === tenantId && ["owner", "manager"].includes((m.role ?? "").toLowerCase()),
  );
  if (staffOk) return true;

  const { data: portal } = await supabase
    .from("customer_users")
    .select("role")
    .eq("auth_user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  const pr = String((portal as { role?: string } | null)?.role ?? "").toLowerCase();
  return pr === "company_admin";
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const firstName = body.firstName?.trim() ?? "";
  const lastName = body.lastName?.trim() ?? "";
  const companyId = body.companyId?.trim();
  const phone = body.phone?.trim() || null;
  const roleRaw = (body.role ?? "employee").toLowerCase().trim();
  const role = roleRaw === "company_admin" ? "company_admin" : "employee";

  if (!email || !companyId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "email and companyId are required (valid email)" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = await assertCanManageCompany(supabase, user.id, companyId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server misconfigured";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    new URL(req.url).origin;
  const redirectTo = `${appUrl.replace(/\/$/, "")}/portal`;

  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim() || email;

  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { first_name: firstName, last_name: lastName, full_name: displayName },
  });

  let targetUserId = invited?.user?.id ?? null;

  if (inviteErr) {
    const msg = inviteErr.message?.toLowerCase() ?? "";
    const already =
      msg.includes("already") || msg.includes("exists") || msg.includes("registered") || msg.includes("duplicate");
    if (!already) {
      return NextResponse.json({ error: inviteErr.message }, { status: 400 });
    }
    const { data: existingUser, error: euErr } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (euErr) return NextResponse.json({ error: euErr.message }, { status: 500 });
    if (!existingUser?.id) {
      return NextResponse.json(
        { error: "User may exist in auth without a profile row; contact support." },
        { status: 400 },
      );
    }
    targetUserId = (existingUser as { id: string }).id;
  }

  if (!targetUserId) {
    return NextResponse.json({ error: "Could not resolve user id" }, { status: 500 });
  }

  const { error: upErr } = await admin.from("users").upsert({ id: targetUserId, email, display_name: displayName }, { onConflict: "id" });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { error: cuErr } = await admin.from("customer_users").insert({
    company_id: companyId,
    auth_user_id: targetUserId,
    first_name: firstName || null,
    last_name: lastName || null,
    email,
    phone,
    role,
    status: "invited",
    invited_by: user.id,
  } as never);

  if (cuErr) {
    const dup = cuErr.message?.toLowerCase().includes("unique") || cuErr.code === "23505";
    return NextResponse.json(
      { error: dup ? "This email is already added for this company." : cuErr.message },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    invited: !inviteErr,
    message: "Invitation sent. The user will receive an email to access the customer portal.",
  });
}
