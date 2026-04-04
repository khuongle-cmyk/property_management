import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureDefaultTaskTemplates } from "@/lib/tasks/defaults";

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const view = (url.searchParams.get("view") ?? "my").trim();
  const status = (url.searchParams.get("status") ?? "").trim();
  const category = (url.searchParams.get("category") ?? "").trim();
  const propertyId = (url.searchParams.get("propertyId") ?? "").trim();
  const assigneeId = (url.searchParams.get("assigneeId") ?? "").trim();
  const clientId = (url.searchParams.get("clientId") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const dueFrom = (url.searchParams.get("dueFrom") ?? "").trim();
  const dueTo = (url.searchParams.get("dueTo") ?? "").trim();
  const archivedParam = (url.searchParams.get("archived") ?? "").trim().toLowerCase();
  const archivedOnly = archivedParam === "1" || archivedParam === "true" || archivedParam === "yes";

  const { data: memberships } = await supabase.from("memberships").select("tenant_id,role").eq("user_id", user.id);
  const roleRows = (memberships ?? []).map((m) => ({
    tenant_id: String(m.tenant_id ?? ""),
    role: String(m.role ?? "").toLowerCase(),
  }));
  const isSuperAdmin = roleRows.some((m) => m.role === "super_admin");
  const tenantIds = [...new Set(roleRows.map((m) => m.tenant_id).filter(Boolean))] as string[];
  if (!isSuperAdmin && !tenantIds.length) return NextResponse.json({ tasks: [], stats: {} });
  for (const tid of tenantIds) await ensureDefaultTaskTemplates(supabase, tid);

  const canViewAll = roleRows.some((m) => ["super_admin", "owner", "manager"].includes(m.role));
  let query = supabase
    .from("client_tasks")
    .select("id,tenant_id,contract_id,contact_id,property_id,room_id,title,description,category,status,priority,type,assigned_to_user_id,due_date,completed_at,notes,order_index,created_at,updated_at")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (!isSuperAdmin) query = query.in("tenant_id", tenantIds);
  if (view === "my" || (!canViewAll && view === "all")) query = query.eq("assigned_to_user_id", user.id);
  if (status) query = query.eq("status", status);
  if (category) query = query.eq("category", category);
  if (propertyId) query = query.eq("property_id", propertyId);
  if (assigneeId) query = query.eq("assigned_to_user_id", assigneeId);
  if (clientId) query = query.eq("contact_id", clientId);
  if (dueFrom) query = query.gte("due_date", dueFrom);
  if (dueTo) query = query.lte("due_date", dueTo);

  const { data: tasks, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let rows = tasks ?? [];
  if (q) rows = rows.filter((t) => (`${t.title} ${t.description ?? ""}`.toLowerCase().includes(q)));

  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
  const stats = archivedOnly
    ? { myTasksToday: 0, overdue: 0, dueThisWeek: 0, completedThisMonth: 0 }
    : {
        myTasksToday: rows.filter((r) => r.assigned_to_user_id === user.id && r.status !== "done" && r.due_date === today).length,
        overdue: rows.filter((r) => r.status !== "done" && r.due_date && r.due_date < today).length,
        dueThisWeek: rows.filter((r) => r.status !== "done" && r.due_date && r.due_date >= today && r.due_date <= weekEnd).length,
        completedThisMonth: rows.filter((r) => r.status === "done" && r.completed_at && String(r.completed_at).slice(0, 10) >= monthStart).length,
      };
  return NextResponse.json({ tasks: rows, stats });
}

const ALLOWED_TASK_CATEGORIES = new Set([
  "access",
  "it",
  "furniture",
  "admin",
  "welcome",
  "invoicing",
  "portal",
  "orientation",
]);

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });

  let category = String(body.category ?? "admin").toLowerCase();
  if (!ALLOWED_TASK_CATEGORIES.has(category)) category = "admin";

  const statusRaw = String(body.status ?? "todo");
  const status =
    statusRaw === "todo" || statusRaw === "in_progress" || statusRaw === "done" || statusRaw === "skipped"
      ? statusRaw
      : "todo";

  let priority = String(body.priority ?? "medium").toLowerCase();
  if (!["urgent", "high", "medium", "low"].includes(priority)) priority = "medium";

  let taskType = String(body.type ?? "internal").toLowerCase();
  if (!["operations", "internal", "service_request"].includes(taskType)) taskType = "internal";

  const description = body.description == null || body.description === "" ? null : String(body.description);
  const assigned_to_user_id =
    body.assigned_to_user_id == null || body.assigned_to_user_id === "" ? null : String(body.assigned_to_user_id);
  const due_date = body.due_date == null || body.due_date === "" ? null : String(body.due_date);
  const contact_id = body.contact_id == null || body.contact_id === "" ? null : String(body.contact_id);
  const property_id = body.property_id == null || body.property_id === "" ? null : String(body.property_id);
  const notes = body.notes == null || body.notes === "" ? null : String(body.notes);

  const { data: memberships } = await supabase.from("memberships").select("tenant_id,role").eq("user_id", user.id);
  const roleRows = (memberships ?? []).map((m) => ({
    tenant_id: String(m.tenant_id ?? ""),
    role: String(m.role ?? "").toLowerCase(),
  }));
  const isSuperAdmin = roleRows.some((m) => m.role === "super_admin");
  const tenantIds = [...new Set(roleRows.map((m) => m.tenant_id).filter(Boolean))] as string[];

  let tenant_id: string | null = null;

  if (property_id) {
    const { data: prop } = await supabase.from("properties").select("tenant_id").eq("id", property_id).maybeSingle();
    const tid = prop?.tenant_id ? String(prop.tenant_id) : null;
    if (tid && (isSuperAdmin || tenantIds.includes(tid))) tenant_id = tid;
  }
  if (!tenant_id && contact_id) {
    const { data: lead } = await supabase.from("leads").select("tenant_id").eq("id", contact_id).maybeSingle();
    const tid = lead?.tenant_id ? String(lead.tenant_id) : null;
    if (tid && (isSuperAdmin || tenantIds.includes(tid))) tenant_id = tid;
  }
  if (!tenant_id && tenantIds.length === 1) tenant_id = tenantIds[0];
  if (!tenant_id && isSuperAdmin && tenantIds.length) tenant_id = tenantIds[0];

  if (!tenant_id) {
    return NextResponse.json(
      { error: "Could not determine workspace. Select a property or company, or use a single-tenant account." },
      { status: 400 },
    );
  }

  const row = {
    tenant_id,
    contract_id: null as string | null,
    contact_id,
    property_id,
    room_id: null as string | null,
    template_id: null as string | null,
    title,
    description,
    category,
    status,
    priority,
    type: taskType,
    assigned_to_user_id,
    due_date,
    notes,
    order_index: 0,
  };

  const { data: created, error } = await supabase.from("client_tasks").insert(row).select("*").maybeSingle();
  if (error || !created) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 400 });

  await supabase.from("task_activities").insert({
    task_id: created.id,
    tenant_id,
    actor_user_id: user.id,
    activity_type: "created",
    from_value: null,
    to_value: null,
    message: "Task created",
  });

  return NextResponse.json({ ok: true, task: created });
}

