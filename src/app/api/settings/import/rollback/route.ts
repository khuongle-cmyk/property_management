import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Body = { batchId?: string };

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const batchId = (body.batchId ?? "").trim();
  if (!batchId) return NextResponse.json({ error: "batchId is required" }, { status: 400 });

  const { data: batch, error: bErr } = await supabase
    .from("import_batches")
    .select("id, import_type")
    .eq("id", batchId)
    .maybeSingle();
  if (bErr || !batch) return NextResponse.json({ error: bErr?.message ?? "Batch not found" }, { status: 404 });

  const type = batch.import_type as string;
  let delErr: { message: string } | null = null;
  if (type === "revenue") {
    const { error } = await supabase.from("historical_revenue").delete().eq("import_batch_id", batchId);
    delErr = error;
  } else if (type === "costs") {
    const { error } = await supabase.from("historical_costs").delete().eq("import_batch_id", batchId);
    delErr = error;
  } else if (type === "invoices") {
    const { error } = await supabase.from("historical_invoices").delete().eq("import_batch_id", batchId);
    delErr = error;
  } else if (type === "occupancy") {
    const { error } = await supabase.from("historical_occupancy").delete().eq("import_batch_id", batchId);
    delErr = error;
  }
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const { error: rmErr } = await supabase.from("import_batches").delete().eq("id", batchId);
  if (rmErr) return NextResponse.json({ error: rmErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
