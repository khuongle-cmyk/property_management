"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/browser";

type ChatMessage = { role: "user" | "assistant"; content: string };

const INTRO =
  "Hi! I can help you with your properties, reports, bookings, tasks, and CRM. Ask in plain language — answers use data we load for your organization.";

function quickActionsForPath(pathname: string | null): { label: string; prompt: string }[] {
  const p = pathname ?? "";
  if (p.startsWith("/reports")) {
    return [
      {
        label: "📊 Summarize this report",
        prompt:
          "Summarize my financial and operational context: revenue and costs trends, and call out anything worth attention.",
      },
      { label: "📈 What's trending up?", prompt: "What metrics in the data look improved vs earlier months?" },
      { label: "⚠️ Any concerns?", prompt: "What risks or negative trends do you see in the provided data?" },
    ];
  }
  if (p.startsWith("/tasks")) {
    return [
      { label: "✅ What's overdue?", prompt: "List overdue tasks from the context and suggest priorities." },
      { label: "📋 Summarize my tasks", prompt: "Summarize open tasks and upcoming deadlines from the context." },
    ];
  }
  if (p.startsWith("/crm")) {
    return [
      { label: "🎯 Which leads need attention?", prompt: "Which pipeline stages need follow-up based on lead counts?" },
      { label: "📧 Draft follow-up emails", prompt: "Draft short follow-up email ideas for leads in negotiation or viewing stages." },
    ];
  }
  if (p.startsWith("/dashboard")) {
    return [
      { label: "📊 How's performance this month?", prompt: "How does the latest month compare to prior months in the data?" },
      { label: "🔮 Predictions for next month?", prompt: "Given recent trends in the context, what might next month look like? Be cautious and qualitative." },
    ];
  }
  if (p.startsWith("/budget")) {
    return [
      { label: "💶 Explain budget vs actuals", prompt: "Help interpret my budgeting data if present in context." },
      { label: "📉 Cost drivers", prompt: "What cost categories stand out in the historical data?" },
    ];
  }
  if (p.startsWith("/bookings")) {
    return [
      { label: "📅 Bookings overview", prompt: "Summarize booking-related information from the context." },
      { label: "🔍 Free meeting rooms tomorrow?", prompt: "Using booking counts for tomorrow in the context, what can we infer about availability?" },
    ];
  }
  return [
    { label: "Revenue last month?", prompt: "What was total revenue in the most recent month in the data, and how does it compare to the prior month?" },
    { label: "Any overdue tasks?", prompt: "How many overdue tasks are there and what are they?" },
    { label: "Draft email to leads", prompt: "Draft a short professional email to follow up with leads in negotiation stage." },
  ];
}

async function consumeAiStream(res: Response, onDelta: (chunk: string) => void): Promise<void> {
  const body = res.body;
  if (!body) throw new Error("No response body");
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of block.split("\n")) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const raw = t.slice(5).trim();
          try {
            const o = JSON.parse(raw) as { t?: string; done?: boolean; error?: string };
            if (o.error) throw new Error(o.error);
            if (o.t) onDelta(o.t);
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

type AiAssistantWidgetProps = {
  /** When set with onPanelOpenChange, panel visibility is controlled by the parent. */
  panelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
  /** Hide the floating launcher — parent opens the panel (e.g. expandable FAB). */
  hideLauncher?: boolean;
};

export default function AiAssistantWidget({
  panelOpen: controlledOpen,
  onPanelOpenChange,
  hideLauncher = false,
}: AiAssistantWidgetProps = {}) {
  const supabase = getSupabaseClient();
  const pathname = usePathname();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    onPanelOpenChange?.(next);
    if (controlledOpen === undefined) setInternalOpen(next);
  };
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const hiddenOnPublicRoute =
    pathname === "/login" ||
    pathname === "/invite" ||
    pathname === "/book/public" ||
    (pathname?.startsWith("/offers/") ?? false) ||
    (pathname?.startsWith("/contact/") ?? false);

  const quick = useMemo(() => quickActionsForPath(pathname), [pathname]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    if (open) {
      setMessages((m) => (m.length === 0 ? [{ role: "assistant", content: INTRO }] : m));
    }
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled) return;
      setIsLoggedIn(Boolean(user));
      setAuthChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const sendPrompt = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      setError(null);

      const userMsg: ChatMessage = { role: "user", content: trimmed };
      const payloadMessages = (() => {
        const base = [...messages, userMsg].filter((m) => m.role === "user" || m.content.trim() !== "");
        return base.slice(-10);
      })();

      setInput("");
      setStreaming(true);
      setMessages((prev) => [...prev, userMsg, { role: "assistant", content: "" }]);

      try {
        const res = await fetch("/api/ai-assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: payloadMessages,
            pathname: pathname ?? "",
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? res.statusText);
        }
        let acc = "";
        await consumeAiStream(res, (chunk) => {
          acc += chunk;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { role: "assistant", content: acc };
            }
            return next;
          });
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Request failed";
        setError(msg);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && !last.content) next.pop();
          return next;
        });
      } finally {
        setStreaming(false);
      }
    },
    [messages, pathname, streaming],
  );

  if (hiddenOnPublicRoute || !authChecked || !isLoggedIn) return null;
  if (hideLauncher && !open) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: "max(24px, calc(env(safe-area-inset-right) + 16px))",
        bottom: "max(88px, calc(env(safe-area-inset-bottom) + 80px))",
        zIndex: 100,
      }}
    >
      {!open ? (
        !hideLauncher ? (
          <button
            type="button"
            title="Open AI assistant"
            aria-label="Open AI assistant"
            onClick={() => {
              setOpen(true);
              setMessages((m) => (m.length === 0 ? [{ role: "assistant", content: INTRO }] : m));
            }}
            style={{
              borderRadius: 999,
              padding: "12px 14px",
              border: "1px solid #6d28d9",
              background: "#7c3aed",
              color: "#fff",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 6,
              boxShadow: "0 10px 24px rgba(76, 29, 149, 0.35)",
            }}
          >
            <span aria-hidden>🤖</span>
            <span>Chat</span>
          </button>
        ) : null
      ) : (
        <div
          style={{
            width: 380,
            maxWidth: "calc(100vw - 32px)",
            background: "#fff",
            border: "1px solid #d1d5db",
            borderRadius: 12,
            boxShadow: "0 10px 35px rgba(0,0,0,0.15)",
            display: "flex",
            flexDirection: "column",
            maxHeight: "min(560px, calc(100vh - 120px))",
          }}
        >
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: 8 }}>
            <span aria-hidden>🤖</span>
            <strong style={{ fontSize: 15 }}>AI Assistant</strong>
            <button type="button" onClick={() => setOpen(false)} style={{ marginLeft: "auto", padding: "4px 8px" }}>
              ✕
            </button>
          </div>

          <div style={{ padding: 12, overflowY: "auto", flex: 1, minHeight: 200, display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "92%",
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: m.role === "user" ? "#ede9fe" : "#f4f4f5",
                  fontSize: 14,
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.45,
                }}
              >
                <div style={{ fontSize: 11, color: "#71717a", marginBottom: 4 }}>{m.role === "user" ? "You" : "Assistant"}</div>
                {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
              </div>
            ))}
            {error && (
              <div style={{ color: "#b91c1c", fontSize: 13, padding: 8, background: "#fef2f2", borderRadius: 8 }}>{error}</div>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ padding: "8px 10px", borderTop: "1px solid #eee", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                disabled={streaming}
                onClick={() => void sendPrompt(q.prompt)}
                style={{
                  fontSize: 12,
                  padding: "6px 8px",
                  borderRadius: 8,
                  border: "1px solid #e4e4e7",
                  background: "#fafafa",
                  cursor: streaming ? "not-allowed" : "pointer",
                  textAlign: "left",
                }}
              >
                {q.label}
              </button>
            ))}
          </div>

          <div style={{ padding: 10, borderTop: "1px solid #eee", display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={streaming}
              placeholder="Type a message…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendPrompt(input);
                }
              }}
              style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 14 }}
            />
            <button
              type="button"
              disabled={streaming || !input.trim()}
              onClick={() => void sendPrompt(input)}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                fontWeight: 600,
                border: "none",
                background: streaming ? "#d4d4d8" : "#7c3aed",
                color: "#fff",
                cursor: streaming ? "not-allowed" : "pointer",
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
