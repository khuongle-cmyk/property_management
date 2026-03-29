import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

type PutBody = {
  /** Super admin may move the fee to another payer org (`tenant_id` on row). */
  tenant_id?: string | null;
  property_id?: string | null;
  fee_name?: string | null;
  name?: string | null;
  fee_category?: string | null;
  calculation_mode?: string | null;
  fee_type?: string | null;
  custom_name?: string | null;
  fixed_amount?: number | null;
  fixed_period?: string | null;
  percentage_value?: number | null;
  percentage_basis?: string | null;
  minimum_fee?: number | null;
  maximum_fee?: number | null;
  is_active?: boolean | null;
  recipient_tenant_id?: string | null;
};

/** PUT /api/admin-fees/[id] — super_admin only */
export async function PUT(req: Request, ctx: Ctx) {
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

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if ("tenant_id" in body) {
    const raw = body.tenant_id;
    const tid = raw === null || raw === undefined || raw === "" ? null : String(raw).trim();
    if (!tid) {
      return NextResponse.json({ error: "tenant_id cannot be empty" }, { status: 400 });
    }
    patch.tenant_id = tid;
  }

  if ("property_id" in body) {
    patch.property_id =
      body.property_id === null || body.property_id === undefined || body.property_id === ""
        ? null
        : String(body.property_id).trim();
  }
  if ("fee_name" in body || "name" in body) {
    const raw = body.fee_name !== undefined ? body.fee_name : body.name;
    patch.name = raw != null && String(raw).trim() !== "" ? String(raw).trim() : null;
  }
  if ("fee_category" in body || "custom_name" in body) {
    const raw = body.fee_category !== undefined ? body.fee_category : body.custom_name;
    const cat = raw != null && String(raw).trim() !== "" ? String(raw).trim() : null;
    patch.custom_name = cat;
    patch.fee_type = cat;
  }
  if ("calculation_mode" in body) {
    const raw = String(body.calculation_mode ?? "").trim().toLowerCase();
    patch.calculation_mode =
      raw === "fixed" || raw === "percentage" || raw === "combination" ? raw : "fixed";
  }
  if ("fixed_amount" in body) patch.fixed_amount = body.fixed_amount ?? null;
  if ("fixed_period" in body) patch.fixed_period = body.fixed_period ?? "monthly";
  if ("percentage_value" in body) patch.percentage_value = body.percentage_value ?? null;
  if ("percentage_basis" in body) patch.percentage_basis = body.percentage_basis ?? null;
  if ("minimum_fee" in body) patch.minimum_fee = body.minimum_fee ?? null;
  if ("maximum_fee" in body) patch.maximum_fee = body.maximum_fee ?? null;
  if ("is_active" in body) patch.is_active = body.is_active !== false;
  if ("recipient_tenant_id" in body) {
    const raw = body.recipient_tenant_id;
    patch.recipient_tenant_id =
      raw === null || raw === undefined || raw === "" ? null : String(raw).trim();
  }

  const { data, error } = await supabase.from("administration_cost_settings").update(patch).eq("id", id).select().single();
  if (error) {
    if (error.code === "PGRST116") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ setting: data });
}

/** DELETE /api/admin-fees/[id] — super_admin only */
export async function DELETE(_req: Request, ctx: Ctx) {
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

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabase.from("administration_cost_settings").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
