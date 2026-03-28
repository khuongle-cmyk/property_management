import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeAssistantLanguage } from "@/lib/voice-assistant/languages";

type MembershipRow = { tenant_id: string | null; role: string | null };
type PropertyRow = { id: string; name: string; tenant_id: string };
type SpaceRow = { id: string; name: string; property_id: string; space_type: string; space_status: string };
type BookingRow = { id: string; status: string | null; start_at: string; end_at: string };
type InvoiceRow = {
  id: string;
  property_id: string;
  due_date: string;
  total_amount: number;
  status: string;
  billing_month: string;
};

type AssistantIntent = "check_room_availability" | "create_booking" | "show_open_invoices" | "unknown";
type IntentResult = {
  intent: AssistantIntent;
  confidence: number;
  parameters: Record<string, unknown>;
  response_text: string;
  requires_confirmation: boolean;
  action_url: string | null;
};

const MANAGER_ROLES = new Set(["super_admin", "owner", "manager", "customer_service", "accounting", "viewer"]);

function extractJsonObject(raw: string): string | null {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  return raw.slice(first, last + 1);
}

function toIsoRange(date: string, startTime: string, durationHours: number) {
  const d = date.trim();
  const st = startTime.trim();
  const start = new Date(`${d}T${st}:00`);
  const end = new Date(start.getTime() + Math.max(0.25, durationHours) * 60 * 60 * 1000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function pickDateOrToday(raw: unknown): string {
  if (typeof raw === "string" && raw.trim().length >= 10) return raw.trim().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function pickTime(raw: unknown): string {
  if (typeof raw === "string" && /^\d{2}:\d{2}$/.test(raw.trim())) return raw.trim();
  return "14:00";
}

function pickDuration(raw: unknown): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return 1;
}

function fallbackIntentFromText(text: string): IntentResult {
  const q = text.toLowerCase();
  if (q.includes("invoice") || q.includes("lasku")) {
    return {
      intent: "show_open_invoices",
      confidence: 0.65,
      parameters: {},
      response_text: "I will show your open invoices.",
      requires_confirmation: false,
      action_url: "/api/voice-assistant/process",
    };
  }
  if (q.includes("book") || q.includes("booking") || q.includes("varaa")) {
    return {
      intent: "create_booking",
      confidence: 0.6,
      parameters: {},
      response_text: "I can create a booking. Please provide room, date, time, and duration.",
      requires_confirmation: false,
      action_url: "/api/voice-assistant/process",
    };
  }
  if (q.includes("available") || q.includes("occupancy") || q.includes("vapaa")) {
    return {
      intent: "check_room_availability",
      confidence: 0.6,
      parameters: {},
      response_text: "I will check room availability.",
      requires_confirmation: false,
      action_url: "/api/voice-assistant/process",
    };
  }
  return {
    intent: "unknown",
    confidence: 0.3,
    parameters: {},
    response_text: "I can help with room availability, bookings, and open invoices in Phase 1.",
    requires_confirmation: false,
    action_url: null,
  };
}

async function whisperTranscribe(audioFile: File, language: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing");

  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("language", language);
  form.append("response_format", "json");
  form.append("file", audioFile, audioFile.name || "voice.webm");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Whisper transcription failed: ${t.slice(0, 300)}`);
  }

  const json = (await resp.json()) as { text?: string };
  const text = json.text?.trim() ?? "";
  if (!text) throw new Error("Whisper returned empty text");
  return text;
}

async function anthropicIntent(
  spokenText: string,
  language: string,
  pagePath: string,
  roles: string[],
  tenantIds: string[],
): Promise<IntentResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallbackIntentFromText(spokenText);

  const system = [
    "You are an intent classifier for a property management voice assistant.",
    `User language: ${language}`,
    `Current page: ${pagePath || "unknown"}`,
    `Roles: ${roles.join(", ") || "none"}`,
    `Tenant IDs in scope: ${tenantIds.join(", ") || "none"}`,
    "Allowed intents in phase 1: check_room_availability, create_booking, show_open_invoices, unknown.",
    "Only output one JSON object, no markdown and no extra commentary.",
    "JSON schema:",
    '{ "intent":"...", "confidence":0.0, "parameters":{}, "response_text":"...", "requires_confirmation":false, "action_url":"/api/voice-assistant/process" }',
  ].join("\n");

  const user = [
    "Available actions:",
    "- check_room_availability: list free meeting rooms/hot desks/venues by property/date/time",
    "- create_booking: create a booking when parameters are present",
    "- show_open_invoices: list open invoices (sent/overdue)",
    "",
    `Spoken request: "${spokenText}"`,
    "",
    "Extract parameters when present:",
    "- property_name",
    "- space",
    "- date (YYYY-MM-DD if explicit)",
    "- start_time (HH:mm)",
    "- duration_hours (number)",
  ].join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 500,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!resp.ok) {
    return fallbackIntentFromText(spokenText);
  }

  const data = (await resp.json()) as { content?: Array<{ type?: string; text?: string }> };
  const rawText =
    data.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim() ?? "";
  const jsonText = extractJsonObject(rawText);
  if (!jsonText) return fallbackIntentFromText(spokenText);

  try {
    const parsed = JSON.parse(jsonText) as IntentResult;
    if (!parsed.intent || !["check_room_availability", "create_booking", "show_open_invoices", "unknown"].includes(parsed.intent)) {
      return fallbackIntentFromText(spokenText);
    }
    return {
      intent: parsed.intent,
      confidence: Number(parsed.confidence) || 0,
      parameters: parsed.parameters ?? {},
      response_text: parsed.response_text ?? "Done.",
      requires_confirmation: !!parsed.requires_confirmation,
      action_url: parsed.action_url ?? "/api/voice-assistant/process",
    };
  } catch {
    return fallbackIntentFromText(spokenText);
  }
}

async function actionCheckAvailability(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  allowedPropertyIds: string[],
  propertiesById: Map<string, PropertyRow>,
  parameters: Record<string, unknown>,
) {
  const propertyName = (parameters.property_name as string | undefined)?.trim().toLowerCase() ?? "";
  const date = pickDateOrToday(parameters.date);
  const startTime = pickTime(parameters.start_time);
  const duration = pickDuration(parameters.duration_hours);
  const desiredType = ((parameters.space_type as string | undefined) ?? "meeting_room").toLowerCase();
  const { startIso, endIso } = toIsoRange(date, startTime, duration);

  const candidatePropertyIds = propertyName
    ? allowedPropertyIds.filter((id) => propertiesById.get(id)?.name.toLowerCase().includes(propertyName))
    : allowedPropertyIds;
  if (!candidatePropertyIds.length) {
    return { ok: false, text: "I could not find that property in your scope." };
  }

  let spacesQuery = supabase
    .from("bookable_spaces")
    .select("id, name, property_id, space_type, space_status")
    .in("property_id", candidatePropertyIds)
    .eq("space_status", "available");

  if (desiredType !== "any") spacesQuery = spacesQuery.eq("space_type", desiredType);

  const { data: spacesData, error: sErr } = await spacesQuery;
  if (sErr) return { ok: false, text: `Availability check failed: ${sErr.message}` };
  const spaces = ((spacesData ?? []) as SpaceRow[]).filter((s) => s.space_type !== "office");
  if (!spaces.length) return { ok: true, text: "No available spaces match your filters." };

  const { data: bookingData } = await supabase
    .from("bookings")
    .select("id, status, start_at, end_at, space_id")
    .in(
      "space_id",
      spaces.map((s) => s.id),
    )
    .lt("start_at", endIso)
    .gt("end_at", startIso);

  const blocked = new Set(
    ((bookingData ?? []) as Array<BookingRow & { space_id: string }>)
      .filter((b) => !["cancelled", "rejected"].includes((b.status ?? "").toLowerCase()))
      .map((b) => b.space_id),
  );

  const free = spaces.filter((s) => !blocked.has(s.id));
  if (!free.length) {
    return { ok: true, text: `No free spaces found for ${date} ${startTime} (${duration}h).` };
  }

  const preview = free
    .slice(0, 8)
    .map((s) => `${s.name} (${propertiesById.get(s.property_id)?.name ?? "Property"})`)
    .join(", ");
  return {
    ok: true,
    text: `Found ${free.length} free space(s) for ${date} ${startTime}: ${preview}${free.length > 8 ? "..." : ""}`,
  };
}

async function actionCreateBooking(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  allowedPropertyIds: string[],
  propertiesById: Map<string, PropertyRow>,
  parameters: Record<string, unknown>,
) {
  const spaceName = (parameters.space as string | undefined)?.trim();
  if (!spaceName) {
    return { ok: false, text: "Please tell me which room to book." };
  }

  const date = pickDateOrToday(parameters.date);
  const startTime = pickTime(parameters.start_time);
  const duration = pickDuration(parameters.duration_hours);
  const propertyName = (parameters.property_name as string | undefined)?.trim().toLowerCase() ?? "";

  const filteredPropertyIds = propertyName
    ? allowedPropertyIds.filter((id) => propertiesById.get(id)?.name.toLowerCase().includes(propertyName))
    : allowedPropertyIds;
  if (!filteredPropertyIds.length) {
    return { ok: false, text: "I could not match that property." };
  }

  const { data: spacesData, error: spaceErr } = await supabase
    .from("bookable_spaces")
    .select("id, name, property_id, space_type, space_status")
    .in("property_id", filteredPropertyIds)
    .neq("space_type", "office")
    .eq("space_status", "available");
  if (spaceErr) return { ok: false, text: `Space lookup failed: ${spaceErr.message}` };

  const spaces = (spacesData ?? []) as SpaceRow[];
  const selected = spaces.find((s) => s.name.toLowerCase().includes(spaceName.toLowerCase()));
  if (!selected) {
    return { ok: false, text: `I could not find "${spaceName}" in your available spaces.` };
  }

  const { startIso, endIso } = toIsoRange(date, startTime, duration);
  const { data: created, error: cErr } = await supabase
    .from("bookings")
    .insert({
      space_id: selected.id,
      booker_type: "registered_user",
      booker_user_id: userId,
      start_at: startIso,
      end_at: endIso,
      purpose: (parameters.purpose as string | undefined)?.trim() ?? "Voice assistant booking",
      attendee_count: Math.max(1, Math.round(Number(parameters.attendee_count) || 1)),
    })
    .select("id, status, total_price")
    .maybeSingle();

  if (cErr || !created) {
    return { ok: false, text: cErr?.message ?? "Could not create booking." };
  }

  return {
    ok: true,
    text: `Booked ${selected.name} on ${date} at ${startTime} for ${duration}h. Reference ${created.id.slice(0, 8)}.`,
  };
}

async function actionOpenInvoices(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantIds: string[],
  allowedPropertyIds: string[],
) {
  let q = supabase
    .from("lease_invoices")
    .select("id, property_id, due_date, total_amount, status, billing_month")
    .in("status", ["sent", "overdue"])
    .order("due_date", { ascending: true })
    .limit(10);

  if (tenantIds.length > 0) q = q.in("tenant_id", tenantIds);
  else q = q.in("property_id", allowedPropertyIds);

  const { data: invData, error } = await q;
  if (error) return { ok: false, text: `Invoice lookup failed: ${error.message}` };

  const rows = (invData ?? []) as InvoiceRow[];
  if (!rows.length) return { ok: true, text: "No open invoices found." };

  const propertyIds = [...new Set(rows.map((r) => r.property_id))];
  const { data: pData } = await supabase.from("properties").select("id, name").in("id", propertyIds);
  const pMap = new Map(((pData ?? []) as Array<{ id: string; name: string | null }>).map((p) => [p.id, p.name ?? "Property"]));

  const lines = rows
    .slice(0, 6)
    .map((r) => `${pMap.get(r.property_id) ?? "Property"}: €${Number(r.total_amount).toFixed(2)} due ${r.due_date} (${r.status})`)
    .join("; ");
  return { ok: true, text: `Open invoices (${rows.length}): ${lines}${rows.length > 6 ? "..." : ""}` };
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";
  let spokenText = "";
  let pagePath = "";
  let languageRaw = "";
  let audioFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    spokenText = String(form.get("text") ?? "").trim();
    pagePath = String(form.get("pagePath") ?? "");
    languageRaw = String(form.get("language") ?? "");
    const candidate = form.get("audio");
    audioFile = candidate instanceof File ? candidate : null;
  } else {
    const body = (await req.json().catch(() => ({}))) as { text?: string; pagePath?: string; language?: string };
    spokenText = body.text?.trim() ?? "";
    pagePath = body.pagePath ?? "";
    languageRaw = body.language ?? "";
  }

  const langFromProfile = (user.user_metadata?.language as string | undefined) ?? "";
  const language = normalizeAssistantLanguage(languageRaw || langFromProfile || "en");

  if (!spokenText && audioFile) {
    try {
      spokenText = await whisperTranscribe(audioFile, language);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed transcription";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }
  if (!spokenText) {
    return NextResponse.json({ error: "No speech or text input provided." }, { status: 400 });
  }

  const { data: memRows } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id);
  const memberships = (memRows ?? []) as MembershipRow[];
  const roles = memberships.map((m) => (m.role ?? "").toLowerCase()).filter(Boolean);
  const tenantIds = [...new Set(memberships.map((m) => m.tenant_id).filter(Boolean))] as string[];
  const isSuperAdmin = roles.includes("super_admin");

  let pQuery = supabase.from("properties").select("id, name, tenant_id").order("name");
  if (!isSuperAdmin) {
    if (!tenantIds.length) return NextResponse.json({ error: "No property scope for user." }, { status: 403 });
    pQuery = pQuery.in("tenant_id", tenantIds);
  }
  const { data: pRows, error: pErr } = await pQuery;
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  const allowedProperties = (pRows ?? []) as PropertyRow[];
  const allowedPropertyIds = allowedProperties.map((p) => p.id);
  const propertiesById = new Map(allowedProperties.map((p) => [p.id, p]));

  const intent = await anthropicIntent(spokenText, language, pagePath, roles, tenantIds);

  let actionResult: { ok: boolean; text: string } = { ok: false, text: intent.response_text };
  if (intent.intent === "check_room_availability") {
    actionResult = await actionCheckAvailability(supabase, allowedPropertyIds, propertiesById, intent.parameters);
  } else if (intent.intent === "create_booking") {
    actionResult = await actionCreateBooking(supabase, user.id, allowedPropertyIds, propertiesById, intent.parameters);
  } else if (intent.intent === "show_open_invoices") {
    actionResult = await actionOpenInvoices(supabase, tenantIds, allowedPropertyIds);
  } else {
    actionResult = { ok: false, text: intent.response_text };
  }

  const actionTaken = intent.intent !== "unknown";
  const finalResponseText = actionResult.text || intent.response_text;

  try {
    await supabase
      .from("voice_commands")
      .insert({
        user_id: user.id,
        tenant_id: tenantIds[0] ?? null,
        language,
        transcribed_text: spokenText,
        intent: intent.intent,
        parameters: intent.parameters,
        action_taken: actionTaken,
        success: actionResult.ok,
      })
      .select("id")
      .maybeSingle();
  } catch {
    // Keep assistant response non-blocking if telemetry table is missing.
  }

  return NextResponse.json({
    ok: true,
    transcribedText: spokenText,
    language,
    intent: {
      ...intent,
      confidence: Number(intent.confidence) || 0,
      action_url: "/api/voice-assistant/process",
      requires_confirmation: false,
    },
    result: {
      success: actionResult.ok,
      responseText: finalResponseText,
      source: {
        model: process.env.ANTHROPIC_API_KEY ? "anthropic" : "fallback",
        roles,
        currentPage: pagePath,
        whisperUsed: !!audioFile,
      },
    },
    phase: "phase-1",
    note:
      "Phase 1 supports availability checks, booking creation, and open-invoice lookup. Confirmation and spoken playback come in later phases.",
    permissions: {
      canUseManagerCommands: roles.some((r) => MANAGER_ROLES.has(r)),
    },
  });
}
