import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureDefaultTaskTemplates } from "@/lib/tasks/defaults";

export async function GET(req: Request) {
  const supabase = createSupabaseServerClient();
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
    .select("id,tenant_id,contract_id,contact_id,property_id,room_id,title,description,category,status,assigned_to_user_id,due_date,completed_at,notes,order_index,created_at,updated_at")
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
  const stats = {
    myTasksToday: rows.filter((r) => r.assigned_to_user_id === user.id && r.status !== "done" && r.due_date === today).length,
    overdue: rows.filter((r) => r.status !== "done" && r.due_date && r.due_date < today).length,
    dueThisWeek: rows.filter((r) => r.status !== "done" && r.due_date && r.due_date >= today && r.due_date <= weekEnd).length,
    completedThisMonth: rows.filter((r) => r.status === "done" && r.completed_at && String(r.completed_at).slice(0, 10) >= monthStart).length,
  };
  return NextResponse.json({ tasks: rows, stats });
}

