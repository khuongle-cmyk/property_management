import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildAssistantContext } from "@/lib/ai-assistant/build-context";
import { REPORT_READER_ROLES } from "@/lib/reports/report-access";

export const runtime = "nodejs";
export const maxDuration = 120;

type ChatMessage = { role: "user" | "assistant"; content: string };

function buildSystemPrompt(pack: Awaited<ReturnType<typeof buildAssistantContext>>, pathname: string): string {
  return [
    "You are an AI assistant for a property management ERP system. You help property managers understand their data and automate tasks.",
    "",
    `Current user: ${pack.userName}`,
    `Organization: ${pack.orgName}`,
    `Current page path: ${pathname || "—"}`,
    `Properties: ${pack.propertyNames.length ? pack.propertyNames.join(", ") : "none"}`,
    "",
    "Available data context (use only this for factual answers; if something is missing, say so):",
    pack.contextData,
    "",
    "Be concise and professional. Use € for currency. For dates prefer Finnish format (e.g. 31.1.2026) when relevant.",
    "Always base quantitative answers on the provided context. Do not invent figures.",
  ].join("\n");
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log("API key exists:", !!apiKey);
  console.log("API key prefix:", apiKey?.substring(0, 10));
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is missing from environment");
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const anthropic = new Anthropic({ apiKey });

  const model = process.env.ANTHROPIC_ASSISTANT_MODEL?.trim() || "claude-sonnet-4-20250514";

  let body: { messages?: ChatMessage[]; pathname?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const trimmed = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-10) as ChatMessage[];

  if (trimmed.length === 0 || trimmed[trimmed.length - 1]?.role !== "user") {
    return NextResponse.json({ error: "messages must end with a user turn" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: mem } = await supabase.from("memberships").select("role").eq("user_id", user.id);
  const roles = (mem ?? []).map((m) => (m.role ?? "").toLowerCase());
  const canUseAi = roles.some((r) => REPORT_READER_ROLES.has(r) || r === "customer_service");
  if (!canUseAi) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const displayName =
    String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email?.split("@")[0] ?? "User") || "User";
  const email = user.email ?? "";

  let pack: Awaited<ReturnType<typeof buildAssistantContext>>;
  try {
    pack = await buildAssistantContext(supabase, user.id, email, displayName);
  } catch (e) {
    console.error("[api/ai-assistant] buildAssistantContext", e);
    return NextResponse.json({ error: "Failed to load context" }, { status: 500 });
  }

  const pathname = typeof body.pathname === "string" ? body.pathname : "";
  const system = buildSystemPrompt(pack, pathname);

  const claudeMessages = trimmed.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const upstream = await anthropic.messages.create({
          model,
          max_tokens: 4096,
          stream: true,
          system,
          messages: claudeMessages,
        });

        for await (const event of upstream) {
          if (event.type !== "content_block_delta") continue;
          const d = event.delta;
          if (d.type === "text_delta" && d.text) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ t: d.text })}\n\n`));
          }
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      } catch (e) {
        console.error("[api/ai-assistant] Anthropic stream", e);
        const msg = e instanceof Error ? e.message : "Stream error";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
