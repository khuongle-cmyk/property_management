import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMarketingAccess } from "@/lib/marketing/access";

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getMarketingAccess(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });

  let body: { tenantId?: string; context?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let tenantId = String(body.tenantId ?? "").trim();
  if (!tenantId) {
    if (isSuperAdmin) tenantId = "";
    else if (tenantIds[0]) tenantId = tenantIds[0];
    else return NextResponse.json({ error: "Invalid tenant" }, { status: 400 });
  } else if (!isSuperAdmin && !tenantIds.includes(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant" }, { status: 400 });
  }

  let tenantName = "workspace";
  if (tenantId) {
    const { data: t } = await supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle();
    tenantName = (t as { name: string } | null)?.name ?? "workspace";
  } else {
    tenantName = "all organizations";
  }

  const prompt = `Write one email subject line only (max 90 chars, no quotes) for ${tenantName}. Context: ${body.context ?? "newsletter"}.`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 80,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    return NextResponse.json({ error: errText.slice(0, 200) }, { status: 502 });
  }

  const json = (await resp.json()) as { content?: Array<{ text?: string }> };
  let text = (json.content?.[0]?.text ?? "").trim().replace(/^["']|["']$/g, "").split("\n")[0] ?? "";
  if (text.length > 120) text = text.slice(0, 117) + "...";
  return NextResponse.json({ subject: text });
}
