"use client";

/**
 * VillageWorks AI Assistant Chat Component
 *
 * Drop this anywhere in your ERP layout.
 * It shows a role badge so users know what access level the AI has.
 *
 * Props:
 *   initialRole — optional, shown while loading (e.g. from session context)
 */

import { useState, useRef, useEffect } from "react";

const ROLE_LABELS = {
  public: { label: "Public", color: "#0f6e56" },
  tenant: { label: "Tenant", color: "#185fa5" },
  staff: { label: "Staff", color: "#534ab7" },
  finance: { label: "Finance", color: "#854f0b" },
  admin: { label: "Admin", color: "#993c1d" },
};

export default function AIAssistant({ initialRole = "public" }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeRole, setActiveRole] = useState(initialRole);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: "user", content: text };
    const updatedMessages = [...messages, userMsg];

    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages }),
      });

      const data = await res.json();

      if (data.role) setActiveRole(data.role); // sync role from server

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply ?? "Something went wrong." },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Connection error. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const roleMeta = ROLE_LABELS[activeRole] ?? ROLE_LABELS.public;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>VillageWorks Assistant</span>
        <span style={{ ...styles.roleBadge, background: roleMeta.color }}>{roleMeta.label}</span>
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {messages.length === 0 && (
          <p style={styles.empty}>Hi! Ask me anything about your spaces, bookings, or account.</p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.bubble,
              ...(msg.role === "user" ? styles.userBubble : styles.aiBubble),
            }}
          >
            {msg.content}
          </div>
        ))}
        {loading && (
          <div style={{ ...styles.bubble, ...styles.aiBubble, opacity: 0.5 }}>Thinking…</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={styles.inputRow}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          rows={1}
          style={styles.textarea}
        />
        <button onClick={sendMessage} disabled={loading || !input.trim()} style={styles.sendBtn}>
          Send
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    maxHeight: "600px",
    border: "1px solid #e5e3da",
    borderRadius: "12px",
    overflow: "hidden",
    fontFamily: "sans-serif",
    fontSize: "14px",
    background: "#fff",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderBottom: "1px solid #e5e3da",
    background: "#f9f8f5",
  },
  title: {
    fontWeight: 500,
    color: "#2c2c2a",
  },
  roleBadge: {
    fontSize: "11px",
    fontWeight: 500,
    color: "#fff",
    padding: "2px 8px",
    borderRadius: "99px",
    letterSpacing: "0.02em",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  empty: {
    color: "#888",
    textAlign: "center",
    marginTop: "32px",
  },
  bubble: {
    maxWidth: "80%",
    padding: "10px 14px",
    borderRadius: "10px",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  },
  userBubble: {
    alignSelf: "flex-end",
    background: "#1d9e75",
    color: "#fff",
    borderBottomRightRadius: "3px",
  },
  aiBubble: {
    alignSelf: "flex-start",
    background: "#f1efe8",
    color: "#2c2c2a",
    borderBottomLeftRadius: "3px",
  },
  inputRow: {
    display: "flex",
    gap: "8px",
    padding: "12px 16px",
    borderTop: "1px solid #e5e3da",
    background: "#f9f8f5",
  },
  textarea: {
    flex: 1,
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid #d3d1c7",
    resize: "none",
    fontFamily: "inherit",
    fontSize: "14px",
    outline: "none",
    lineHeight: 1.5,
  },
  sendBtn: {
    padding: "8px 18px",
    borderRadius: "8px",
    border: "none",
    background: "#1d9e75",
    color: "#fff",
    fontWeight: 500,
    cursor: "pointer",
    fontSize: "14px",
  },
};
