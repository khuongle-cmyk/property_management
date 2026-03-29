import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const MAX_BYTES = 40 * 1024 * 1024;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id: floorPlanId } = await ctx.params;
  if (!floorPlanId?.trim()) return NextResponse.json({ error: "Missing id" }, { status: 400 });

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
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
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
    const buf = Buffer.from(await file.arrayBuffer());
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
      if (!b || !Buffer.isBuffer(b)) throw new Error("pdf2pic returned no buffer");
      uploadBuffer = b;
      contentType = "image/png";
      ext = "png";
    } catch (e) {
      return NextResponse.json(
        {
          error: e instanceof Error ? e.message : "PDF conversion failed",
          hint:
            "Server PDF raster needs GraphicsMagick/ImageMagick + Ghostscript, or upload a PNG/JPEG. You can also open the editor and use the browser PDF fallback.",
          fallback: true,
        },
        { status: 503 },
      );
    }
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
  const { error: upErr } = await admin.storage.from("floor-plan-backgrounds").upload(path, uploadBuffer, {
    contentType,
    upsert: true,
  });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

  const { data: pub } = admin.storage.from("floor-plan-backgrounds").getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  const { error: uErr } = await supabase
    .from("floor_plans")
    .update({
      background_image_url: publicUrl,
      show_background: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", floorPlanId);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  return NextResponse.json({ publicUrl, path });
}
