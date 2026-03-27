import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const ALLOWED_ROLES = [
  "owner",
  "manager",
  "accounting",
  "customer_service",
  "maintenance",
] as const;

type AllowedRole = (typeof ALLOWED_ROLES)[number];

type Body = {
  email?: string;
  role?: string;
  tenantId?: string;
};

function normalizeRole(role: string | undefined): AllowedRole | null {
  const r = (role ?? "").trim().toLowerCase();
  if ((ALLOWED_ROLES as readonly string[]).includes(r)) return r as AllowedRole;
  return null;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const tenantId = body.tenantId?.trim();
  const role = normalizeRole(body.role);

  if (!email || !tenantId || !role) {
    return NextResponse.json({ error: "email, role, tenantId are required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: memberships, error: mErr } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id);

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const rows = (memberships ?? []) as { tenant_id: string | null; role: string | null }[];
  const roles = rows.map((r) => (r.role ?? "").toLowerCase());
  const isSuperAdmin = roles.includes("super_admin");
  const isOwnerOnTenant = rows.some(
    (r) => r.tenant_id === tenantId && (r.role ?? "").toLowerCase() === "owner"
  );

  // Permissions:
  // - super_admin: invite any allowed role to any tenant
  // - owner: invite own staff only (no owner role escalation), only in own tenant
  if (!isSuperAdmin) {
    if (!isOwnerOnTenant) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (role === "owner") {
      return NextResponse.json(
        { error: "Owners can invite staff roles only (manager/accounting/customer_service/maintenance)" },
        { status: 403 }
      );
    }
  }

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server misconfigured";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Validate tenant exists.
  const { data: tenant, error: tErr } = await admin
    .from("tenants")
    .select("id, name")
    .eq("id", tenantId)
    .maybeSingle();
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!tenant) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    new URL(req.url).origin;
  const redirectTo = `${appUrl.replace(/\/$/, "")}/invite`;

  // Try invite first.
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  });

  let targetUserId = invited.user?.id ?? null;

  if (inviteErr) {
    const msg = inviteErr.message?.toLowerCase() ?? "";
    const already =
      msg.includes("already") ||
      msg.includes("exists") ||
      msg.includes("registered") ||
      msg.includes("duplicate");

    if (!already) {
      return NextResponse.json({ error: inviteErr.message }, { status: 400 });
    }

    // Existing account: resolve id from public.users and still grant membership.
    const { data: existingUser, error: euErr } = await admin
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (euErr) return NextResponse.json({ error: euErr.message }, { status: 500 });
    if (!existingUser?.id) {
      return NextResponse.json(
        { error: "User already exists in auth, but no profile row found in public.users" },
        { status: 400 }
      );
    }
    targetUserId = existingUser.id;
  }

  if (!targetUserId) {
    return NextResponse.json({ error: "Could not resolve invited user id" }, { status: 500 });
  }

  // Ensure profile row exists/updated.
  const { error: upErr } = await admin
    .from("users")
    .upsert({ id: targetUserId, email }, { onConflict: "id" });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Grant membership (upsert role).
  const { error: memUpsertErr } = await admin
    .from("memberships")
    .upsert(
      {
        tenant_id: tenantId,
        user_id: targetUserId,
        role,
      },
      { onConflict: "tenant_id,user_id" }
    );

  if (memUpsertErr) {
    return NextResponse.json({ error: memUpsertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    invited: !inviteErr,
    tenantName: (tenant as { name: string }).name,
    role,
    email,
  });
}

