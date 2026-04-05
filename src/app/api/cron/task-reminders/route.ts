import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing Supabase env vars");
  return createClient(url, serviceKey);
}

/** Civil date YYYY-MM-DD + delta days (calendar arithmetic). */
function addDaysToYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d + delta);
  const u = new Date(ms);
  return `${u.getUTCFullYear()}-${String(u.getUTCMonth() + 1).padStart(2, "0")}-${String(u.getUTCDate()).padStart(2, "0")}`;
}

function tomorrowYmdHelsinki(): string {
  const todayHelsinki = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return addDaysToYmd(todayHelsinki, 1);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 503 });
  }
  const resend = new Resend(resendKey);

  const supabase = getAdminSupabase();

  const tomorrowStr = tomorrowYmdHelsinki();

  const { data: tasks, error: taskErr } = await supabase
    .from("client_tasks")
    .select("id, title, description, category, status, priority, type, due_date, assigned_to_user_id, property_id, contact_id, tenant_id")
    .eq("due_date", tomorrowStr)
    .in("status", ["todo", "in_progress"])
    .not("assigned_to_user_id", "is", null)
    .eq("archived", false);

  if (taskErr) {
    console.error("Task reminder query error:", taskErr);
    return NextResponse.json({ error: taskErr.message }, { status: 500 });
  }

  if (!tasks || tasks.length === 0) {
    return NextResponse.json({ sent: 0, message: "No tasks due tomorrow" });
  }

  const userIds = [...new Set(tasks.map((t) => t.assigned_to_user_id).filter(Boolean))] as string[];

  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("user_id, email, first_name, last_name, display_name")
    .in("user_id", userIds);

  const userMap: Record<string, { email: string; name: string }> = {};
  if (profiles) {
    for (const p of profiles) {
      const email = typeof p.email === "string" ? p.email.trim() : "";
      if (!email) continue;
      const name =
        (typeof p.display_name === "string" && p.display_name.trim()) ||
        [p.first_name, p.last_name].filter(Boolean).join(" ") ||
        email;
      userMap[p.user_id] = { email, name };
    }
  }
  for (const uid of userIds) {
    if (userMap[uid]) continue;
    const { data: authData } = await supabase.auth.admin.getUserById(uid);
    const email = authData.user?.email?.trim();
    if (!email) continue;
    const meta = authData.user?.user_metadata as { full_name?: string; name?: string } | undefined;
    const name = String(meta?.full_name ?? meta?.name ?? "").trim() || email;
    userMap[uid] = { email, name };
  }

  const propertyIds = [...new Set(tasks.map((t) => t.property_id).filter(Boolean))] as string[];
  const propertyNames: Record<string, string> = {};
  if (propertyIds.length) {
    const { data: props } = await supabase.from("properties").select("id, name").in("id", propertyIds);
    if (props) {
      for (const p of props) propertyNames[p.id] = p.name || "Unknown";
    }
  }

  type TaskRow = (typeof tasks)[number];
  const tasksByUser: Record<string, TaskRow[]> = {};
  for (const t of tasks) {
    const uid = t.assigned_to_user_id!;
    if (!tasksByUser[uid]) tasksByUser[uid] = [];
    tasksByUser[uid].push(t);
  }

  let sent = 0;
  const errors: string[] = [];

  const tasksBaseUrl = (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://property-management-system-inky.vercel.app"
  ).replace(/\/$/, "");
  const tasksHref = `${tasksBaseUrl}/tasks`;

  for (const [userId, userTasks] of Object.entries(tasksByUser)) {
    const user = userMap[userId];
    if (!user?.email) {
      errors.push(`No email found for user ${userId}`);
      continue;
    }

    const taskListHtml = userTasks
      .map((t) => {
        const property = t.property_id ? propertyNames[t.property_id] || "" : "";
        const priorityLabel: Record<string, string> = {
          urgent: "🔴 Urgent",
          high: "🟡 High",
          medium: "🔵 Medium",
          low: "⚪ Low",
        };
        const title = escapeHtml(t.title);
        const descRaw = t.description?.trim() ?? "";
        const desc =
          descRaw.length > 0
            ? `<br><span style="color: #5a5550; font-size: 13px;">${escapeHtml(descRaw.slice(0, 100))}${descRaw.length > 100 ? "..." : ""}</span>`
            : "";
        const pr = String(t.priority ?? "");
        return `
          <tr style="border-bottom: 1px solid #e5e0da;">
            <td style="padding: 12px 16px; font-size: 14px; color: #1a1a1a;">
              <strong>${title}</strong>
              ${desc}
            </td>
            <td style="padding: 12px 16px; font-size: 13px; color: #5a5550;">${escapeHtml(property)}</td>
            <td style="padding: 12px 16px; font-size: 13px;">${priorityLabel[pr] || escapeHtml(pr)}</td>
            <td style="padding: 12px 16px; font-size: 13px; color: #5a5550; text-transform: capitalize;">${escapeHtml(String(t.category ?? ""))}</td>
          </tr>
        `;
      })
      .join("");

    const safeName = escapeHtml(user.name);
    const emailHtml = `
      <div style="font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; background-color: #faf8f5; padding: 32px;">
        <div style="background-color: #21524F; color: #fff; padding: 24px 32px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; font-size: 22px; font-weight: 400; font-family: Georgia, serif;">Task Reminder</h1>
          <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.85;">Hi ${safeName}, you have ${userTasks.length} ${userTasks.length === 1 ? "task" : "tasks"} due tomorrow (${tomorrowStr})</p>
        </div>
        <div style="background-color: #fff; border: 1px solid #e5e0da; border-top: none; border-radius: 0 0 12px 12px; overflow: hidden;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background-color: #F3DFC6;">
                <th style="padding: 10px 16px; text-align: left; font-size: 12px; font-weight: 600; color: #5a5550; text-transform: uppercase; letter-spacing: 0.04em;">Task</th>
                <th style="padding: 10px 16px; text-align: left; font-size: 12px; font-weight: 600; color: #5a5550; text-transform: uppercase;">Property</th>
                <th style="padding: 10px 16px; text-align: left; font-size: 12px; font-weight: 600; color: #5a5550; text-transform: uppercase;">Priority</th>
                <th style="padding: 10px 16px; text-align: left; font-size: 12px; font-weight: 600; color: #5a5550; text-transform: uppercase;">Category</th>
              </tr>
            </thead>
            <tbody>
              ${taskListHtml}
            </tbody>
          </table>
        </div>
        <div style="text-align: center; margin-top: 24px;">
          <a href="${tasksHref.replace(/"/g, "&quot;")}" style="display: inline-block; background-color: #21524F; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">View Tasks</a>
        </div>
        <p style="text-align: center; margin-top: 16px; font-size: 12px; color: #8a8580;">VillageWorks Finland Oy — WorkspaceOS</p>
      </div>
    `;

    try {
      const { error: sendErr } = await resend.emails.send({
        from: "WorkspaceOS <noreply@villageworks.com>",
        to: user.email,
        subject: `📋 ${userTasks.length} ${userTasks.length === 1 ? "task" : "tasks"} due tomorrow — ${tomorrowStr}`,
        html: emailHtml,
      });
      if (sendErr) {
        console.error(`Resend error for ${user.email}:`, sendErr);
        errors.push(`Failed: ${user.email}`);
      } else {
        sent++;
      }
    } catch (err) {
      console.error(`Failed to send reminder to ${user.email}:`, err);
      errors.push(`Failed: ${user.email}`);
    }
  }

  console.log(`Task reminders sent: ${sent}/${Object.keys(tasksByUser).length}`);
  return NextResponse.json({ sent, total: tasks.length, errors: errors.length ? errors : undefined });
}

export async function POST(req: Request) {
  return GET(req);
}
