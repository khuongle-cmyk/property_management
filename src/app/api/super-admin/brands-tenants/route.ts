import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: mRows, error: mErr } = await supabase.from("memberships").select("role").eq("user_id", user.id);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  const isSuperAdmin = (mRows ?? []).some((m) => String(m.role ?? "").toLowerCase() === "super_admin");
  if (!isSuperAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase.from("tenants").select("id,name").order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, tenants: data ?? [] });
}

