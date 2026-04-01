/**
 * VillageWorks AI Chat API Route
 * File: app/api/chat/route.js  (or pages/api/chat.js for Pages Router)
 *
 * - Validates session before any AI call (this app uses Supabase Auth, not NextAuth)
 * - Scopes system prompt to the user's role
 * - Never exposes raw financial/HR data without auth
 *
 * Original template used getServerSession/next-auth; replace with createSupabaseServerClient
 * if you add NextAuth and session.user.role later.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/aiRoles";

export const runtime = "nodejs";

/** Map ERP membership roles → VillageWorks AI role keys. */
function membershipsToAiRole(roles) {
  const r = new Set((roles ?? []).map((x) => String(x).toLowerCase()));
  if (r.has("super_admin")) return "admin";
  if (r.has("accounting")) return "finance";
  if (r.has("owner") || r.has("manager")) return "admin";
  if (r.has("customer_service") || r.has("maintenance")) return "staff";
  return "tenant";
}

export async function POST(req) {
  // ── 1. Auth + role (Supabase) ─────────────────────────────────────────────
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({
      reply: "Hi! Please sign in to VillageWorks to use the AI assistant. I can help you with properties, bookings, reports and more once you're logged in.",
      role: "public",
    });
  }

  let role = "public";
  let userContext = {};

  const { data: mem } = await supabase.from("memberships").select("role, tenant_id").eq("user_id", user.id);
  const memRoles = (mem ?? []).map((m) => m.role).filter(Boolean);
  role = membershipsToAiRole(memRoles);
  const tenantId = (mem ?? []).find((m) => m.tenant_id)?.tenant_id ?? null;
  const name =
    String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email?.split("@")[0] ?? "") ||
    undefined;
  userContext = {
    ...(name ? { name } : {}),
    ...(tenantId ? { tenantId } : {}),
  };

  // ── 2. Parse request ─────────────────────────────────────────────────────
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { messages } = body;
  if (!messages || !Array.isArray(messages)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  // ── 3. Build scoped system prompt ─────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(role, userContext);

  // ── 4. (Optional) Inject scoped data context ──────────────────────────────
  // Fetch only the data this role is allowed to see and inject as context.
  // Example: for tenants, fetch their own invoices from your ERP/DB.
  // const dataContext = await fetchDataForRole(role, session?.user?.tenantId);
  // If you have data, prepend it as a system message or append to systemPrompt.

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  // ── 5. Call Anthropic ─────────────────────────────────────────────────────
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_ASSISTANT_MODEL?.trim() || "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    let errPayload = { status: response.status };
    try {
      errPayload = await response.json();
    } catch {
      errPayload.detail = await response.text();
    }
    return Response.json({ error: errPayload }, { status: 500 });
  }

  const data = await response.json();
  const reply = data.content?.[0]?.text ?? "Sorry, I couldn't generate a response.";

  return Response.json({ reply, role });
}
