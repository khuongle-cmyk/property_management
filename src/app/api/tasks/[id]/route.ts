import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Body = {
  status?: "todo" | "in_progress" | "done" | "skipped";
  assigned_to_user_id?: string | null;
  due_date?: string | null;
  notes?: string | null;
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = id?.trim();
  if (!taskId) return NextResponse.json({ error: "Missing task id" }, { status: 400 });
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { data: current, error: curErr } = await supabase
    .from("client_tasks")
    .select("id,tenant_id,status,assigned_to_user_id,due_date")
    .eq("id", taskId)
    .maybeSingle();
  if (curErr || !current) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status) {
    patch.status = body.status;
    if (body.status === "done") {
      patch.completed_at = new Date().toISOString();
      patch.completed_by_user_id = user.id;
    }
  }
  if (body.assigned_to_user_id !== undefined) patch.assigned_to_user_id = body.assigned_to_user_id;
  if (body.due_date !== undefined) patch.due_date = body.due_date;
  if (body.notes !== undefined) patch.notes = body.notes;

  const { data, error } = await supabase.from("client_tasks").update(patch).eq("id", taskId).select("*").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const activityRows: Array<Record<string, unknown>> = [];
  if (body.status && body.status !== current.status) {
    activityRows.push({
      task_id: taskId,
      tenant_id: current.tenant_id,
      actor_user_id: user.id,
      activity_type: "status_changed",
      from_value: current.status,
      to_value: body.status,
      message: `Status changed: ${current.status} -> ${body.status}`,
    });
    if (body.status === "done") {
      activityRows.push({
        task_id: taskId,
        tenant_id: current.tenant_id,
        actor_user_id: user.id,
        activity_type: "completed",
        from_value: null,
        to_value: "done",
        message: "Task completed",
      });
    }
  }
  if (body.assigned_to_user_id !== undefined && body.assigned_to_user_id !== current.assigned_to_user_id) {
    activityRows.push({
      task_id: taskId,
      tenant_id: current.tenant_id,
      actor_user_id: user.id,
      activity_type: "reassigned",
      from_value: current.assigned_to_user_id,
      to_value: body.assigned_to_user_id,
      message: `Reassigned task`,
    });
  }
  if (body.due_date !== undefined && body.due_date !== current.due_date) {
    activityRows.push({
      task_id: taskId,
      tenant_id: current.tenant_id,
      actor_user_id: user.id,
      activity_type: "due_date_changed",
      from_value: current.due_date,
      to_value: body.due_date,
      message: `Due date changed`,
    });
  }
  if (activityRows.length) {
    await supabase.from("task_activities").insert(activityRows);
  }
  return NextResponse.json({ ok: true, task: data });
}

