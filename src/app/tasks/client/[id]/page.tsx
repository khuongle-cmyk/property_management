"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/date/format";

type Task = {
  id: string;
  title: string;
  category: string;
  status: "todo" | "in_progress" | "done" | "skipped";
  assigned_to_user_id: string | null;
  due_date: string | null;
  completed_at: string | null;
};

const CATS = ["access", "it", "furniture", "admin", "welcome", "invoicing", "portal", "orientation"] as const;

export default function ClientTasksPage() {
  const params = useParams();
  const clientId = typeof params.id === "string" ? params.id : "";
  const [tasks, setTasks] = useState<Task[]>([]);

  async function load() {
    if (!clientId) return;
    const r = await fetch(`/api/tasks?view=all&clientId=${encodeURIComponent(clientId)}`);
    const j = (await r.json()) as { tasks?: Task[] };
    if (r.ok) setTasks((j.tasks ?? []) as Task[]);
  }
  useEffect(() => {
    void load();
  }, [clientId]);

  const progress = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "done").length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [tasks]);

  return (
    <main style={{ display: "grid", gap: 12 }}>
      <h1 style={{ margin: 0 }}>Client onboarding tasks</h1>
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 10 }}>
        <div style={{ fontSize: 13, color: "#64748b" }}>Progress</div>
        <div style={{ height: 10, background: "#e2e8f0", borderRadius: 999, overflow: "hidden", marginTop: 6 }}>
          <div style={{ width: `${progress.pct}%`, height: "100%", background: "#1a5c5a" }} />
        </div>
        <div style={{ marginTop: 6 }}>{progress.done}/{progress.total} completed</div>
      </div>
      {CATS.map((c) => {
        const rows = tasks.filter((t) => t.category === c);
        if (!rows.length) return null;
        return (
          <section key={c} style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 10 }}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>{c.toUpperCase().replace("_", " ")}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {rows.map((t) => (
                <div key={t.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span>{t.status === "done" ? "☑" : "☐"}</span>
                  <span style={{ flex: 1 }}>{t.title}</span>
                  <span style={{ fontSize: 12, color: "#64748b" }}>
                    {t.status === "done"
                      ? `Done ${t.completed_at ? formatDate(t.completed_at) : ""}`
                      : `Due ${t.due_date ?? "n/a"}`}
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

