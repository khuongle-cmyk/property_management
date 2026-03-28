import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseTuloslaskelmaFromArrayBuffer } from "@/lib/procountor/tuloslaskelma";
import { decodeProcountorFileText } from "@/lib/procountor/decode";

/**
 * Debug endpoint: upload Tuloslaskelma CSV (multipart field "file").
 * Logs decode/parsing steps to the server terminal. Does not write to the database.
 *
 * There is no `src/app/api/import/procountor` route — parsing normally runs in the browser;
 * use this route to see ISO-8859-1 text and parse logs in `npm run dev` output.
 */
export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: 'Missing file field "file"' }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const text = decodeProcountorFileText(buffer);
  console.log("[procountor-parse] File text first 500 chars:", text.substring(0, 500));

  const rows = parseTuloslaskelmaFromArrayBuffer(buffer, null, { debug: true });
  console.log("[procountor-parse] Parsed row count:", rows.length);

  return NextResponse.json({
    ok: true,
    parsedRowCount: rows.length,
    message: "Check server terminal for detailed logs.",
  });
}
