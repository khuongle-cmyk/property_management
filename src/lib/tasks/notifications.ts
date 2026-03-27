import { Resend } from "resend";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function notifyTaskAssignees(taskIds: string[]): Promise<void> {
  if (!taskIds.length) return;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const supabase = getSupabaseAdminClient();
  const { data: tasks } = await supabase
    .from("client_tasks")
    .select("id,title,due_date,assigned_to_user_id,contact_id")
    .in("id", taskIds);
  const assigneeIds = [...new Set((tasks ?? []).map((t) => t.assigned_to_user_id).filter(Boolean))] as string[];
  if (!assigneeIds.length) return;
  const resend = new Resend(apiKey);
  for (const uid of assigneeIds) {
    const userTasks = (tasks ?? []).filter((t) => t.assigned_to_user_id === uid);
    if (!userTasks.length) continue;
    const authUser = await supabase.auth.admin.getUserById(uid);
    const email = authUser.data.user?.email;
    if (!email) continue;
    const list = userTasks
      .slice(0, 10)
      .map((t) => `<li>${t.title} (due ${t.due_date ?? "n/a"})</li>`)
      .join("");
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "Tasks <onboarding@resend.dev>",
      to: email,
      subject: `New onboarding tasks assigned (${userTasks.length})`,
      html: `<p>You have new onboarding tasks.</p><ul>${list}</ul>`,
    });
  }
}

