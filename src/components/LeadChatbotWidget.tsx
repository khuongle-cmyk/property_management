"use client";

import { useMemo, useState } from "react";

type StepKey = "name" | "email" | "company" | "interestedSpaceType" | "approxSizeM2" | "approxBudgetEurMonth" | "preferredMoveInDate";
type FieldMap = Record<StepKey, string>;

const STEPS: Array<{ key: StepKey; question: string; placeholder?: string; type?: string }> = [
  { key: "name", question: "What is your name?", placeholder: "Jane Doe" },
  { key: "email", question: "What is your email?", placeholder: "jane@company.com", type: "email" },
  { key: "company", question: "Company name?", placeholder: "Acme Ltd" },
  { key: "interestedSpaceType", question: "What type of space do you need?", placeholder: "office / meeting_room / venue / hot_desk" },
  { key: "approxSizeM2", question: "Approximate size needed (m2)?", placeholder: "120" },
  { key: "approxBudgetEurMonth", question: "Approximate budget (€ / month)?", placeholder: "2500" },
  { key: "preferredMoveInDate", question: "When do you need it? (YYYY-MM-DD)", placeholder: "2026-06-01" },
];

export default function LeadChatbotWidget() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [input, setInput] = useState("");
  const [answers, setAnswers] = useState<FieldMap>({
    name: "",
    email: "",
    company: "",
    interestedSpaceType: "",
    approxSizeM2: "",
    approxBudgetEurMonth: "",
    preferredMoveInDate: "",
  });
  const [messages, setMessages] = useState<string[]>(["Hi! I can help collect your requirements and pass them to our team."]);
  const [sending, setSending] = useState(false);

  const currentStep = useMemo(() => STEPS[step] ?? null, [step]);

  async function submit() {
    if (!currentStep || !input.trim()) return;
    const value = input.trim();
    setMessages((m) => [...m, `You: ${value}`]);
    setAnswers((a) => ({ ...a, [currentStep.key]: value }));
    setInput("");

    if (step < STEPS.length - 1) {
      const next = step + 1;
      setStep(next);
      setMessages((m) => [...m, STEPS[next].question]);
      return;
    }

    setSending(true);
    const payload = { ...answers, [currentStep.key]: value };
    const resp = await fetch("/api/leads/public-chatbot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSending(false);
    if (resp.ok) {
      setMessages((m) => [...m, "Thanks! I created your lead and the team was notified."]);
    } else {
      const data = (await resp.json()) as { error?: string };
      setMessages((m) => [...m, `Sorry, something went wrong: ${data.error ?? "Unknown error"}`]);
    }
  }

  return (
    <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 80 }}>
      {!open ? (
        <button onClick={() => { setOpen(true); setMessages((m) => (m.length > 1 ? m : [...m, STEPS[0].question])); }} style={{ borderRadius: 999, padding: "12px 16px", border: "1px solid #111", background: "#111", color: "#fff" }}>
          Chat with us
        </button>
      ) : (
        <div style={{ width: 330, background: "#fff", border: "1px solid #d1d5db", borderRadius: 12, boxShadow: "0 10px 35px rgba(0,0,0,0.15)" }}>
          <div style={{ padding: 10, borderBottom: "1px solid #eee", display: "flex" }}>
            <strong>Lead chatbot</strong>
            <button onClick={() => setOpen(false)} style={{ marginLeft: "auto" }}>Close</button>
          </div>
          <div style={{ padding: 10, maxHeight: 260, overflowY: "auto", display: "grid", gap: 8 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ fontSize: 14 }}>{m}</div>
            ))}
          </div>
          <div style={{ padding: 10, borderTop: "1px solid #eee", display: "flex", gap: 6 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
              placeholder={currentStep?.placeholder ?? "Type your message"}
              type={currentStep?.type ?? "text"}
              style={{ flex: 1, padding: 8 }}
            />
            <button onClick={submit} disabled={sending || !input.trim()}>
              {sending ? "..." : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

