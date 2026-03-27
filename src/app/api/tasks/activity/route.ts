import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const taskId = (url.searchParams.get("taskId") ?? "").trim();
  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });

  const [{ data: task }, { data: acts }, { data: comments }] = await Promise.all([
    supabase
      .from("client_tasks")
      .select("id,tenant_id,created_at,completed_at,completed_by_user_id,status")
      .eq("id", taskId)
      .maybeSingle(),
    supabase
      .from("task_activities")
      .select("id,task_id,actor_user_id,activity_type,from_value,to_value,message,created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true }),
    supabase
      .from("task_comments")
      .select("id,task_id,user_id,comment,created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true }),
  ]);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const timeline: Array<{
    id: string;
    type: string;
    created_at: string;
    actor_user_id: string | null;
    actor_name: string | null;
    text: string;
  }> = [];
  timeline.push({
    id: `created:${task.id}`,
    type: "created",
    created_at: task.created_at,
    actor_user_id: null,
    actor_name: "System",
    text: "Task created",
  });
  for (const a of acts ?? []) {
    timeline.push({
      id: `activity:${a.id}`,
      type: a.activity_type,
      created_at: a.created_at,
      actor_user_id: a.actor_user_id,
      actor_name: null,
      text:
        a.message ??
        (a.from_value || a.to_value
          ? `${a.activity_type.replace(/_/g, " ")}: ${a.from_value ?? "—"} -> ${a.to_value ?? "—"}`
          : a.activity_type.replace(/_/g, " ")),
    });
  }
  for (const c of comments ?? []) {
    timeline.push({
      id: `comment:${c.id}`,
      type: "comment",
      created_at: c.created_at,
      actor_user_id: c.user_id,
      actor_name: null,
      text: c.comment,
    });
  }
  const ids = [...new Set(timeline.map((t) => t.actor_user_id).filter(Boolean))] as string[];
  const admin = getSupabaseAdminClient();
  const nameById = new Map<string, string>();
  for (const uid of ids) {
    const u = await admin.auth.admin.getUserById(uid);
    const meta = u.data.user?.user_metadata as { full_name?: string; name?: string } | undefined;
    const display = String(meta?.full_name ?? meta?.name ?? u.data.user?.email ?? `${uid.slice(0, 8)}…`).trim();
    nameById.set(uid, display);
  }
  for (const t of timeline) {
    if (!t.actor_user_id) t.actor_name = "System";
    else t.actor_name = nameById.get(t.actor_user_id) ?? `${t.actor_user_id.slice(0, 8)}…`;
  }
  timeline.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return NextResponse.json({ timeline });
}

