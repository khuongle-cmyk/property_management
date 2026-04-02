import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { FLOOR_PLANS_STORAGE_BUCKET } from "@/lib/floor-plans/storage-bucket";
import { FLOOR_PLAN_BACKGROUND_SIGNED_URL_EXPIRY } from "@/lib/floor-plans/background-storage-path";

const MAX_BYTES = 40 * 1024 * 1024;

/** First match of architectural scale 1:N in PDF text; returns N (e.g. 150 for "1:150"). */
async function detectScaleFromPdfBuffer(buf: Buffer): Promise<number | undefined> {
  try {
    const pdfjs = await import("pdfjs-dist");
    const data = new Uint8Array(buf.length);
    data.set(buf);
    const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => {
        if (item && typeof item === "object" && "str" in item && typeof (item as { str: unknown }).str === "string") {
          return (item as { str: string }).str;
        }
        return "";
      })
      .join(" ");
    const m = text.match(/1:\s*(\d+)/);
    if (!m) return undefined;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch (e) {
    console.warn("[floor-plans/background] PDF scale detection failed", e);
    return undefined;
  }
}

/**
 * POST multipart: field "file" — PDF, PNG, JPEG, WebP, or SVG.
 * PDFs are stored as application/pdf; the editor renders the first page in the browser (PDF.js).
 * Other types upload to Supabase Storage and set floor_plans.background_image_url to the object path (signed URLs are issued on read).
 */
export async function handleFloorPlanBackgroundUpload(req: Request, floorPlanId: string) {
  if (!floorPlanId?.trim()) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

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

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 40 MB)" }, { status: 400 });

  const { data: plan, error: pErr } = await supabase
    .from("floor_plans")
    .select("id, tenant_id")
    .eq("id", floorPlanId)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!plan?.tenant_id) return NextResponse.json({ error: "Floor plan not found" }, { status: 404 });

  const lower = file.name?.toLowerCase() ?? "";
  const tenantId = plan.tenant_id as string;

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch {
    return NextResponse.json({ error: "Server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }

  let uploadBuffer: Buffer;
  let contentType: string;
  let ext: string;

  if (lower.endsWith(".pdf")) {
    uploadBuffer = Buffer.from(await file.arrayBuffer());
    contentType = "application/pdf";
    ext = "pdf";
  } else if (lower.endsWith(".svg")) {
    const buf = Buffer.from(await file.arrayBuffer());
    try {
      const sharp = (await import("sharp")).default;
      uploadBuffer = await sharp(buf).png().toBuffer();
      contentType = "image/png";
      ext = "png";
    } catch {
      return NextResponse.json(
        { error: "SVG raster failed. Install sharp on the server or upload PNG/JPEG." },
        { status: 400 },
      );
    }
  } else if (/\.(png|jpg|jpeg|webp)$/i.test(lower)) {
    uploadBuffer = Buffer.from(await file.arrayBuffer());
    contentType =
      lower.endsWith(".png") ? "image/png" : lower.endsWith(".webp") ? "image/webp" : "image/jpeg";
    ext = lower.endsWith(".png") ? "png" : lower.endsWith(".webp") ? "webp" : "jpg";
  } else {
    return NextResponse.json(
      { error: "Unsupported type. Use .pdf, .png, .jpg, .jpeg, .webp, or .svg" },
      { status: 400 },
    );
  }

  const path = `${tenantId}/${floorPlanId}/bg-${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage.from(FLOOR_PLANS_STORAGE_BUCKET).upload(path, uploadBuffer, {
    contentType,
    upsert: true,
  });
  if (upErr) {
    console.error("[floor-plans/background] storage upload", upErr);
    return NextResponse.json(
      {
        error: upErr.message,
        hint: "Ensure the Storage bucket exists and policies allow service uploads. Run sql/storage_floor_plans_bucket.sql in Supabase SQL Editor.",
      },
      { status: 500 },
    );
  }

  const { data: signed, error: signErr } = await admin.storage
    .from(FLOOR_PLANS_STORAGE_BUCKET)
    .createSignedUrl(path, FLOOR_PLAN_BACKGROUND_SIGNED_URL_EXPIRY);
  if (signErr || !signed?.signedUrl) {
    console.error("[floor-plans/background] createSignedUrl", signErr);
    return NextResponse.json(
      { error: signErr?.message ?? "Could not create signed URL for background" },
      { status: 500 },
    );
  }
  const displayUrl = signed.signedUrl;

  const { error: uErr } = await supabase
    .from("floor_plans")
    .update({
      background_image_url: path,
      show_background: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", floorPlanId);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  const base = { publicUrl: displayUrl, url: displayUrl, path };
  if (lower.endsWith(".pdf")) {
    const detectedScale = await detectScaleFromPdfBuffer(uploadBuffer);
    return NextResponse.json({
      ...base,
      detected_scale: detectedScale ?? null,
    });
  }

  return NextResponse.json(base);
}
