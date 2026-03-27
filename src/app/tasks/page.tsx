"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "@/lib/date/format";

type Task = {
  id: string;
  tenant_id?: string | null;
  title: string;
  description: string | null;
  contact_id: string | null;
  property_id: string | null;
  room_id: string | null;
  category: string;
  status: "todo" | "in_progress" | "done" | "skipped";
  assigned_to_user_id: string | null;
  due_date: string | null;
  notes: string | null;
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState({ myTasksToday: 0, overdue: 0, dueThisWeek: 0, completedThisMonth: 0 });
  const [view, setView] = useState<"my" | "all">("my");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"list" | "board">("list");
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [timeline, setTimeline] = useState<Array<{ id: string; type: string; created_at: string; actor_user_id: string | null; actor_name?: string | null; text: string }>>([]);
  const [members, setMembers] = useState<Array<{ user_id: string; role: string | null; name?: string; label: string }>>([]);
  const [allMemberNames, setAllMemberNames] = useState<Record<string, string>>({});
  const [commentText, setCommentText] = useState("");

  async function load() {
    const params = new URLSearchParams();
    params.set("view", view);
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    if (q) params.set("q", q);
    const r = await fetch(`/api/tasks?${params.toString()}`);
    const j = (await r.json()) as { tasks?: Task[]; stats?: typeof stats };
    if (r.ok) {
      const nextTasks = j.tasks ?? [];
      setTasks(nextTasks);
      setStats(j.stats ?? stats);
      const tenantIds = [...new Set(nextTasks.map((t) => String(t.tenant_id ?? "")).filter(Boolean))];
      if (tenantIds.length) {
        const rm = await fetch(`/api/tasks/members?tenantIds=${encodeURIComponent(tenantIds.join(","))}`);
        const jm = (await rm.json()) as { members?: Array<{ user_id: string; name?: string; label: string }> };
        if (rm.ok) {
          const map: Record<string, string> = {};
          for (const m of jm.members ?? []) map[m.user_id] = m.name ?? m.label;
          setAllMemberNames(map);
        }
      } else {
        setAllMemberNames({});
      }
    }
  }
  useEffect(() => {
    void load();
  }, [view, status, category]);

  const grouped = useMemo(() => {
    const out: Record<string, Task[]> = { todo: [], in_progress: [], done: [], skipped: [] };
    for (const t of tasks) out[t.status].push(t);
    return out;
  }, [tasks]);

  async function quickComplete(task: Task) {
    await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: task.status === "done" ? "todo" : "done" }),
    });
    await load();
  }

  async function openDetail(task: Task) {
    setOpenTask(task);
    const [ra, rm] = await Promise.all([
      fetch(`/api/tasks/activity?taskId=${encodeURIComponent(task.id)}`),
      fetch(`/api/tasks/members?taskId=${encodeURIComponent(task.id)}`),
    ]);
    const ja = (await ra.json()) as { timeline?: Array<{ id: string; type: string; created_at: string; actor_user_id: string | null; actor_name?: string | null; text: string }> };
    const jm = (await rm.json()) as { members?: Array<{ user_id: string; role: string | null; name?: string; label: string }> };
    if (ra.ok) setTimeline(ja.timeline ?? []);
    if (rm.ok) setMembers(jm.members ?? []);
  }

  async function addComment() {
    if (!openTask || !commentText.trim()) return;
    await fetch("/api/tasks/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: openTask.id, comment: commentText.trim() }),
    });
    setCommentText("");
    await openDetail(openTask);
  }

  async function updateTaskDetail(patch: Partial<Pick<Task, "assigned_to_user_id" | "due_date" | "status">>) {
    if (!openTask) return;
    await fetch(`/api/tasks/${openTask.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await load();
    await openDetail({ ...openTask, ...patch } as Task);
  }

  const filtered = q.trim()
    ? tasks.filter((t) => `${t.title} ${t.description ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    : tasks;
  const memberNameById = new Map(members.map((m) => [m.user_id, m.name ?? m.label]));

  return (
    <main style={{ display: "grid", gap: 12 }}>
      <h1 style={{ margin: 0 }}>Tasks</h1>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
        <Stat label="My tasks today" value={stats.myTasksToday} />
        <Stat label="Overdue" value={stats.overdue} danger />
        <Stat label="Due this week" value={stats.dueThisWeek} />
        <Stat label="Completed this month" value={stats.completedThisMonth} />
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select value={view} onChange={(e) => setView(e.target.value as "my" | "all")}><option value="my">My tasks</option><option value="all">All tasks</option></select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All status</option><option value="todo">todo</option><option value="in_progress">in_progress</option><option value="done">done</option><option value="skipped">skipped</option></select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All category</option>{["access","it","furniture","admin","welcome","invoicing","portal","orientation"].map((c)=><option key={c} value={c}>{c}</option>)}</select>
        <input placeholder="Client or task search" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" onClick={() => setMode((m) => (m === "list" ? "board" : "list"))}>{mode === "list" ? "Board view" : "List view"}</button>
        <button type="button" onClick={() => void load()}>Refresh</button>
      </section>

      {mode === "list" ? (
        <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["", "Task", "Category", "Assignee", "Due", "Status", "Actions"].map((h) => <th key={h} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((t) => {
                const overdue = t.status !== "done" && t.due_date && t.due_date < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={t.id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}><input type="checkbox" checked={t.status === "done"} onChange={() => void quickComplete(t)} /></td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>
                      <div>{t.title}</div>
                      {t.contact_id ? <Link href={`/tasks/client/${encodeURIComponent(t.contact_id)}`}>Client view</Link> : null}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{t.category}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>
                      {t.assigned_to_user_id
                        ? allMemberNames[t.assigned_to_user_id] ??
                          memberNameById.get(t.assigned_to_user_id) ??
                          `${t.assigned_to_user_id.slice(0, 8)}…`
                        : "Unassigned"}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9", color: overdue ? "#b91c1c" : undefined }}>{t.due_date ?? "—"}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{t.status}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>
                      <button type="button" onClick={() => void openDetail(t)}>Details</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
          {(["todo", "in_progress", "done", "skipped"] as const).map((s) => (
            <div key={s} style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 8 }}>
              <strong>{s.replace("_", " ")}</strong>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {(grouped[s] ?? []).map((t) => (
                  <div key={t.id} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 8 }}>
                    <div style={{ fontWeight: 600 }}>{t.title}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{t.due_date ?? "No due date"}</div>
                    <div style={{ fontSize: 12, color: "#475569" }}>
                      {t.assigned_to_user_id
                        ? allMemberNames[t.assigned_to_user_id] ?? `${t.assigned_to_user_id.slice(0, 8)}…`
                        : "Unassigned"}
                    </div>
                    <button type="button" onClick={() => void openDetail(t)} style={{ marginTop: 4 }}>Open</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {openTask ? (
        <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 12, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>{openTask.title}</h2>
            <button type="button" onClick={() => setOpenTask(null)}>Close</button>
          </div>
          <p style={{ margin: 0 }}>{openTask.description ?? "No description"}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void updateTaskDetail({ status: "in_progress" })}>In progress</button>
            <button type="button" onClick={() => void updateTaskDetail({ status: "done" })}>Mark complete</button>
            <label>
              Status{" "}
              <select value={openTask.status} onChange={(e) => void updateTaskDetail({ status: e.target.value as Task["status"] })}>
                <option value="todo">todo</option>
                <option value="in_progress">in_progress</option>
                <option value="done">done</option>
                <option value="skipped">skipped</option>
              </select>
            </label>
            <label>
              Assignee{" "}
              <select
                value={openTask.assigned_to_user_id ?? ""}
                onChange={(e) => void updateTaskDetail({ assigned_to_user_id: e.target.value || null })}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.label}</option>
                ))}
              </select>
            </label>
            <label>
              Due date{" "}
              <input
                type="date"
                value={openTask.due_date ?? ""}
                onChange={(e) => void updateTaskDetail({ due_date: e.target.value || null })}
              />
            </label>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <strong>Activity feed</strong>
            <div style={{ display: "grid", gap: 8, maxHeight: 340, overflowY: "auto", paddingRight: 4 }}>
              {timeline.map((e) => (
                <div key={e.id} style={{ display: "grid", gridTemplateColumns: "32px 1fr", gap: 8, alignItems: "start" }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#e2e8f0", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700 }}>
                    {initials(e.actor_name ?? null)}
                  </div>
                  <div style={{ border: "1px solid #f1f5f9", borderRadius: 8, padding: 8 }}>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{formatDateTime(e.created_at)}</div>
                    <div style={{ fontSize: 12, color: "#334155", marginBottom: 2 }}>{e.actor_name ?? "System"}</div>
                    <div>{e.text}</div>
                  </div>
                </div>
              ))}
            </div>
            <textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} rows={2} placeholder="Add comment" />
            <button type="button" onClick={() => void addComment()}>Add note</button>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function initials(name: string | null): string {
  const n = (name ?? "").trim();
  if (!n) return "SY";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 10 }}>
      <div style={{ fontSize: 12, color: "#64748b" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: danger ? "#b91c1c" : undefined }}>{value}</div>
    </div>
  );
}

