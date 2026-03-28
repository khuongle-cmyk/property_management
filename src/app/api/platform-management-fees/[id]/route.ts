import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

type PatchBody = {
  property_id?: string | null;
  year?: number;
  month?: number;
  amount_eur?: number;
  calculation_notes?: string | null;
};

export async function PATCH(req: Request, ctx: Ctx) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: mRows, error: mErr } = await supabase.from("memberships").select("role").eq("user_id", user.id);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  const isSuper = (mRows ?? []).some((m) => String(m.role ?? "").toLowerCase() === "super_admin");
  if (!isSuper) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("property_id" in body) {
    patch.property_id =
      body.property_id === null || body.property_id === undefined || body.property_id === ""
        ? null
        : String(body.property_id).trim();
  }
  if (body.year != null) {
    const y = Number(body.year);
    if (!Number.isFinite(y) || y < 2000 || y > 2100) return NextResponse.json({ error: "Invalid year" }, { status: 400 });
    patch.year = Math.floor(y);
  }
  if (body.month != null) {
    const mo = Number(body.month);
    if (!Number.isFinite(mo) || mo < 1 || mo > 12) return NextResponse.json({ error: "Invalid month" }, { status: 400 });
    patch.month = Math.floor(mo);
  }
  if (body.amount_eur != null) {
    const a = Number(body.amount_eur);
    if (!Number.isFinite(a) || a < 0) return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    patch.amount_eur = a;
  }
  if ("calculation_notes" in body) {
    patch.calculation_notes = body.calculation_notes ?? null;
  }

  const { data, error } = await supabase.from("platform_management_fees").update(patch).eq("id", id).select().single();
  if (error) {
    if (error.code === "PGRST116") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (error.code === "23505") {
      return NextResponse.json({ error: "A fee already exists for this tenant, property, and month." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ fee: data });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: mRows, error: mErr } = await supabase.from("memberships").select("role").eq("user_id", user.id);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  const isSuper = (mRows ?? []).some((m) => String(m.role ?? "").toLowerCase() === "super_admin");
  if (!isSuper) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabase.from("platform_management_fees").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
