import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertPropertyFinancialAccess } from "@/lib/property-costs/access";
import { isPropertyCostType } from "@/lib/property-costs/constants";

function periodMonthFromCostDate(costDate: string): string {
  const d = new Date(`${costDate.slice(0, 10)}T12:00:00.000Z`);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

type PatchBody = {
  costType?: string;
  description?: string;
  amount?: number;
  costDate?: string;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  notes?: string | null;
  status?: "scheduled" | "confirmed" | "cancelled";
};

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const entryId = params.id?.trim();
  if (!entryId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: existing, error: readErr } = await supabase
    .from("property_cost_entries")
    .select("property_id")
    .eq("id", entryId)
    .maybeSingle();

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!existing?.property_id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await assertPropertyFinancialAccess(supabase, user.id, existing.property_id, "write");
  if (!gate.ok) return NextResponse.json({ error: gate.error ?? "Forbidden" }, { status: 403 });

  const patch: Record<string, unknown> = {};
  if (body.costType !== undefined) {
    const t = body.costType.trim().toLowerCase();
    if (!isPropertyCostType(t)) return NextResponse.json({ error: "Invalid costType" }, { status: 400 });
    patch.cost_type = t;
  }
  if (body.description !== undefined) patch.description = body.description.trim() || "(no description)";
  if (body.amount !== undefined) {
    const a = Number(body.amount);
    if (!Number.isFinite(a) || a < 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    patch.amount = a;
  }
  if (body.costDate !== undefined) {
    const cd = body.costDate.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cd)) {
      return NextResponse.json({ error: "costDate must be YYYY-MM-DD" }, { status: 400 });
    }
    patch.cost_date = cd;
    patch.period_month = periodMonthFromCostDate(cd);
  }
  if (body.supplierName !== undefined) patch.supplier_name = body.supplierName?.trim() || null;
  if (body.invoiceNumber !== undefined) patch.invoice_number = body.invoiceNumber?.trim() || null;
  if (body.notes !== undefined) patch.notes = body.notes?.trim() || null;
  if (body.status !== undefined) {
    if (!["scheduled", "confirmed", "cancelled"].includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = body.status;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from("property_cost_entries")
    .update(patch)
    .eq("id", entryId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entry: row });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const entryId = params.id?.trim();
  if (!entryId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: existing, error: readErr } = await supabase
    .from("property_cost_entries")
    .select("property_id")
    .eq("id", entryId)
    .maybeSingle();

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!existing?.property_id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await assertPropertyFinancialAccess(supabase, user.id, existing.property_id, "write");
  if (!gate.ok) return NextResponse.json({ error: gate.error ?? "Forbidden" }, { status: 403 });

  const { error } = await supabase.from("property_cost_entries").delete().eq("id", entryId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
