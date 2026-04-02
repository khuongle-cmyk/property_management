"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const PETROL = "#1a5c50";
const CREAM = "#faf9f7";

type StepKey = "name" | "email" | "company" | "yTunnus" | "interestedSpaceType" | "approxSizeM2";

type StepDef = {
  key: StepKey;
  question: string;
  placeholder?: string;
  type?: string;
  /** Allow Send with empty input (normalized to skip). */
  optional?: boolean;
};

const STEPS: StepDef[] = [
  { key: "name", question: "What is your name?", placeholder: "Type your answer…" },
  { key: "email", question: "What is your email?", placeholder: "Type your answer…", type: "email" },
  { key: "company", question: "Company name?", placeholder: "Type your answer…" },
  {
    key: "yTunnus",
    question: "Y-tunnus? (optional — leave blank to skip)",
    placeholder: "Type your answer…",
    optional: true,
  },
  {
    key: "interestedSpaceType",
    question: "What type of space do you need?",
    placeholder: "e.g. office, meeting room, venue",
  },
  { key: "approxSizeM2", question: "Approximate size needed (m²)?", placeholder: "Type your answer…" },
];

type FieldMap = Record<StepKey, string>;

const EMPTY_ANSWERS: FieldMap = {
  name: "",
  email: "",
  company: "",
  yTunnus: "",
  interestedSpaceType: "",
  approxSizeM2: "",
};

type ChatMessage = { role: "bot" | "user"; text: string };

const INTRO_TEXT = "Hi! I can help collect your requirements and pass them to our team.";

function normalizeYOptional(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (lower === "skip" || t === "-") return "";
  return t;
}

function ChatBubbleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 5h16v10H8l-4 3V5z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

type LeadChatbotWidgetProps = {
  panelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
  hideLauncher?: boolean;
};

export default function LeadChatbotWidget({
  panelOpen: controlledOpen,
  onPanelOpenChange,
  hideLauncher = false,
}: LeadChatbotWidgetProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    onPanelOpenChange?.(next);
    if (controlledOpen === undefined) setInternalOpen(next);
  };
  const [step, setStep] = useState(0);
  const [input, setInput] = useState("");
  const [answers, setAnswers] = useState<FieldMap>({ ...EMPTY_ANSWERS });
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "bot", text: INTRO_TEXT }]);
  const [sending, setSending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentStep = useMemo(() => STEPS[step] ?? null, [step]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  function closePanel() {
    setOpen(false);
    if (completed) {
      setCompleted(false);
      setStep(0);
      setAnswers({ ...EMPTY_ANSWERS });
      setInput("");
      setMessages([{ role: "bot", text: INTRO_TEXT }, { role: "bot", text: STEPS[0].question }]);
    }
  }

  function openPanel() {
    setOpen(true);
    setMessages((prev) => {
      if (prev.length === 1 && prev[0]?.text === INTRO_TEXT) {
        return [...prev, { role: "bot", text: STEPS[0].question }];
      }
      return prev;
    });
  }

  async function submit() {
    if (!currentStep || sending || completed) return;
    const trimmed = input.trim();
    if (!currentStep.optional && !trimmed) return;

    const value = currentStep.key === "yTunnus" ? normalizeYOptional(input) : trimmed;

    const userLabel = currentStep.key === "yTunnus" && !value ? "Skipped" : trimmed;

    const nextAnswers: FieldMap = { ...answers, [currentStep.key]: value };

    setMessages((m) => [...m, { role: "user", text: userLabel }]);
    setAnswers(nextAnswers);
    setInput("");

    if (step < STEPS.length - 1) {
      const next = step + 1;
      setStep(next);
      setMessages((m) => [...m, { role: "bot", text: STEPS[next].question }]);
      return;
    }

    setSending(true);
    const resp = await fetch("/api/leads/public-chatbot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nextAnswers.name,
        email: nextAnswers.email,
        company: nextAnswers.company,
        yTunnus: nextAnswers.yTunnus || undefined,
        interestedSpaceType: nextAnswers.interestedSpaceType,
        approxSizeM2: nextAnswers.approxSizeM2,
      }),
    });
    setSending(false);
    if (resp.ok) {
      setCompleted(true);
      setMessages((m) => [...m, { role: "bot", text: "Thank you! We’ve received your details and our team will be in touch soon." }]);
    } else {
      const data = (await resp.json()) as { error?: string };
      setMessages((m) => [...m, { role: "bot", text: `Sorry, something went wrong: ${data.error ?? "Unknown error"}` }]);
    }
  }

  const canSend = Boolean(currentStep && !sending && !completed && (currentStep.optional || input.trim().length > 0));

  const fabBottom = "max(96px, calc(env(safe-area-inset-bottom) + 88px))";
  const fabRight = "max(24px, calc(env(safe-area-inset-right) + 16px))";

  if (hideLauncher && !open) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: fabRight,
        bottom: fabBottom,
        zIndex: 100,
        fontFamily: "var(--font-dm-sans), 'DM Sans', sans-serif",
      }}
    >
      <style>{`
        @keyframes lc-panel-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes lc-msg-fade {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .lc-panel-animate { animation: lc-panel-in 0.32s ease-out both; }
        .lc-msg-bot { animation: lc-msg-fade 0.38s ease-out both; }
      `}</style>

      {!open ? (
        !hideLauncher ? (
          <button
            type="button"
            title="Open chat"
            aria-label="Open VillageWorks chat"
            onClick={openPanel}
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              border: "none",
              background: PETROL,
              color: "#fff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
              transition: "transform 0.2s ease, box-shadow 0.2s ease",
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = "scale(0.96)";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            <ChatBubbleIcon />
          </button>
        ) : null
      ) : (
        <div
          className="lc-panel-animate"
          style={{
            width: 380,
            maxWidth: "min(380px, calc(100vw - 32px))",
            maxHeight: 500,
            height: "min(500px, calc(100vh - 120px))",
            display: "flex",
            flexDirection: "column",
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
            background: CREAM,
            border: "1px solid #e5e7eb",
          }}
        >
          <header
            style={{
              flexShrink: 0,
              background: PETROL,
              color: "#fff",
              padding: "14px 16px",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.3 }}>VillageWorks</div>
              <div style={{ fontSize: 13, opacity: 0.9, marginTop: 2 }}>How can we help?</div>
            </div>
            <button
              type="button"
              aria-label="Close chat"
              onClick={closePanel}
              style={{
                marginLeft: "auto",
                background: "transparent",
                border: "none",
                color: "#fff",
                cursor: "pointer",
                padding: 4,
                borderRadius: 8,
                display: "grid",
                placeItems: "center",
                opacity: 0.95,
              }}
            >
              <CloseIcon />
            </button>
          </header>

          <div
            ref={scrollRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              WebkitOverflowScrolling: "touch",
            }}
          >
            {messages.map((msg, i) => (
              <div
                key={`${i}-${msg.text.slice(0, 24)}`}
                className={msg.role === "bot" ? "lc-msg-bot" : undefined}
                style={{
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  padding: "10px 14px",
                  borderRadius: 12,
                  fontSize: 14,
                  lineHeight: 1.45,
                  background: msg.role === "user" ? PETROL : "#fff",
                  color: msg.role === "user" ? "#fff" : "#111827",
                  border: msg.role === "user" ? "none" : "1px solid #e5e7eb",
                  boxShadow: msg.role === "bot" ? "0 1px 2px rgba(0,0,0,0.04)" : undefined,
                }}
              >
                {msg.text}
              </div>
            ))}
          </div>

          <div
            style={{
              flexShrink: 0,
              padding: "12px 16px",
              borderTop: "1px solid #e5e7eb",
              background: "#fff",
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            {completed ? (
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280", lineHeight: 1.45 }}>
                You’re all set. Close the chat to start a new enquiry anytime.
              </p>
            ) : (
              <>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={sending || !currentStep}
                  placeholder="Type your answer…"
                  type={currentStep?.type ?? "text"}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (canSend) void submit();
                    }
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    color: "#111827",
                    fontSize: 14,
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!canSend}
                  style={{
                    flexShrink: 0,
                    padding: "10px 16px",
                    borderRadius: 8,
                    border: "none",
                    background: PETROL,
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: canSend ? "pointer" : "not-allowed",
                    opacity: canSend ? 1 : 0.45,
                    fontFamily: "inherit",
                  }}
                >
                  {sending ? "…" : "Send"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
