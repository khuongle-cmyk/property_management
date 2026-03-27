import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertPropertyFinancialAccess } from "@/lib/property-costs/access";

/**
 * Deletes a recurring template and removes future scheduled line items.
 * Confirmed historical rows keep their template_id cleared.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const templateId = id?.trim();
  if (!templateId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: tpl, error: tErr } = await supabase
    .from("property_recurring_cost_templates")
    .select("property_id")
    .eq("id", templateId)
    .maybeSingle();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!tpl?.property_id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await assertPropertyFinancialAccess(supabase, user.id, tpl.property_id, "write");
  if (!gate.ok) return NextResponse.json({ error: gate.error ?? "Forbidden" }, { status: 403 });

  const { error: delSched } = await supabase
    .from("property_cost_entries")
    .delete()
    .eq("recurring_template_id", templateId)
    .eq("status", "scheduled");

  if (delSched) return NextResponse.json({ error: delSched.message }, { status: 500 });

  const { error: clear } = await supabase
    .from("property_cost_entries")
    .update({ recurring_template_id: null })
    .eq("recurring_template_id", templateId);

  if (clear) return NextResponse.json({ error: clear.message }, { status: 500 });

  const { error: delTpl } = await supabase
    .from("property_recurring_cost_templates")
    .delete()
    .eq("id", templateId);

  if (delTpl) return NextResponse.json({ error: delTpl.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
