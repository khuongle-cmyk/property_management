import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { FLOOR_PLANS_STORAGE_BUCKET } from "@/lib/floor-plans/storage-bucket";
import { FLOOR_PLAN_BACKGROUND_SIGNED_URL_EXPIRY } from "@/lib/floor-plans/background-storage-path";

export const runtime = "nodejs";

const MAX_BYTES = 40 * 1024 * 1024;

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const floorPlanId = String(formData.get("floorPlanId") ?? "").trim();
  const file = formData.get("file");
  if (!floorPlanId) return NextResponse.json({ error: "floorPlanId required" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });

  const lower = file.name?.toLowerCase() ?? "";
  if (!lower.endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are accepted on this endpoint" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 40 MB)" }, { status: 400 });
  }

  const { data: plan, error: pErr } = await supabase
    .from("floor_plans")
    .select("id, tenant_id")
    .eq("id", floorPlanId)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!plan?.tenant_id) return NextResponse.json({ error: "Floor plan not found" }, { status: 404 });

  const buf = Buffer.from(await file.arrayBuffer());

  let pngBuffer: Buffer;
  try {
    const { fromBuffer } = await import("pdf2pic");
    const converter = fromBuffer(buf, {
      density: 200,
      format: "png",
      width: 2400,
      height: 2400,
      preserveAspectRatio: true,
    });
    const page = await converter(1, { responseType: "buffer" });
    const b = page.buffer;
    if (!b || !Buffer.isBuffer(b)) {
      throw new Error("pdf2pic returned no buffer");
    }
    pngBuffer = b;
  } catch (e) {
    const hint =
      "Server PDF raster failed (GraphicsMagick/ImageMagick + Ghostscript are required for pdf2pic). " +
      "Upload a PNG/JPEG from your PDF, or use the in-browser PDF option in the editor.";
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "PDF conversion failed",
        hint,
        fallback: true,
      },
      { status: 503 },
    );
  }

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch {
    return NextResponse.json({ error: "Server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }

  const path = `${plan.tenant_id}/${floorPlanId}/pdf-bg-${Date.now()}.png`;
  const { error: upErr } = await admin.storage.from(FLOOR_PLANS_STORAGE_BUCKET).upload(path, pngBuffer, {
    contentType: "image/png",
    upsert: true,
  });
  if (upErr) {
    console.error("[floor-plans/background-pdf] storage upload", upErr);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const { data: signed, error: signErr } = await admin.storage
    .from(FLOOR_PLANS_STORAGE_BUCKET)
    .createSignedUrl(path, FLOOR_PLAN_BACKGROUND_SIGNED_URL_EXPIRY);
  if (signErr || !signed?.signedUrl) {
    console.error("[floor-plans/background-pdf] createSignedUrl", signErr);
    return NextResponse.json({ error: signErr?.message ?? "Could not create signed URL" }, { status: 500 });
  }

  return NextResponse.json({
    publicUrl: signed.signedUrl,
    path,
  });
}
