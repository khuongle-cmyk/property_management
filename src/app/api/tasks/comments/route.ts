import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const taskId = (url.searchParams.get("taskId") ?? "").trim();
  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
  const { data, error } = await supabase
    .from("task_comments")
    .select("id,task_id,user_id,comment,created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ comments: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json()) as { taskId?: string; comment?: string };
  const taskId = String(body.taskId ?? "").trim();
  const comment = String(body.comment ?? "").trim();
  if (!taskId || !comment) return NextResponse.json({ error: "taskId and comment required" }, { status: 400 });
  const { data, error } = await supabase
    .from("task_comments")
    .insert({ task_id: taskId, user_id: user.id, comment })
    .select("id,task_id,user_id,comment,created_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { data: task } = await supabase
    .from("client_tasks")
    .select("tenant_id")
    .eq("id", taskId)
    .maybeSingle();
  if (task?.tenant_id) {
    await supabase.from("task_activities").insert({
      task_id: taskId,
      tenant_id: task.tenant_id,
      actor_user_id: user.id,
      activity_type: "comment_added",
      from_value: null,
      to_value: null,
      message: "Comment added",
    });
  }
  return NextResponse.json({ ok: true, comment: data });
}

