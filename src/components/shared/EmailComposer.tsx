"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import type { EmailSource } from "@/lib/email/types";
import { defaultVillageworksFromEmail } from "@/lib/email/default-from";

const inp: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid rgba(13,79,79,0.25)",
  width: "100%",
  boxSizing: "border-box",
};

const btnPri: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--petrol, #0d4f4f)",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 600,
};

const btnSec: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 8,
  border: "1px solid rgba(13,79,79,0.35)",
  background: "#fff",
  cursor: "pointer",
};

export type EmailComposerProps = {
  source: EmailSource;
  /** Single address vs paste-many (bulk is used with marketing-style flows). */
  mode?: "single" | "bulk";
  tenantId: string;
  /** CRM: public.leads.id for provenance columns. */
  leadId?: string | null;
  relatedType?: string | null;
  defaultTo?: string;
  initialSubject?: string;
  initialPreview?: string;
  initialHtml?: string;
  initialFromName?: string;
  initialFromEmail?: string;
  initialReplyTo?: string;
  onSent?: () => void;
  onCancel?: () => void;
};

export default function EmailComposer({
  source,
  mode = "single",
  tenantId,
  leadId,
  defaultTo = "",
  initialSubject = "",
  initialPreview = "",
  initialHtml = "<p></p>",
  initialFromName = "",
  initialFromEmail = "",
  initialReplyTo = "",
  onSent,
  onCancel,
}: EmailComposerProps) {
  const [subject, setSubject] = useState(initialSubject);
  const [previewText, setPreviewText] = useState(initialPreview);
  const [bodyHtml, setBodyHtml] = useState(initialHtml);
  const [fromName, setFromName] = useState(initialFromName);
  const [fromEmail, setFromEmail] = useState(initialFromEmail);
  const [replyTo, setReplyTo] = useState(initialReplyTo);
  const [toSingle, setToSingle] = useState(defaultTo);
  const [bulkLines, setBulkLines] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setSubject(initialSubject);
    setPreviewText(initialPreview);
    setBodyHtml(initialHtml);
    setFromName(initialFromName);
    setReplyTo(initialReplyTo);
    setToSingle(defaultTo);
  }, [initialSubject, initialPreview, initialHtml, initialFromName, initialReplyTo, defaultTo]);

  useEffect(() => {
    let c = false;
    (async () => {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (c || !user) return;
      const meta = (user.user_metadata ?? {}) as Record<string, string | undefined>;
      const display =
        (meta.full_name ?? meta.name ?? meta.display_name ?? "").trim() ||
        (user.email ?? "").split("@")[0] ||
        "";
      if (!initialFromName && display) setFromName(display);
      const def = defaultVillageworksFromEmail(user.email ?? null);
      if (!initialFromEmail && def) setFromEmail(def);
      if (!initialReplyTo && (user.email ?? "").trim()) setReplyTo((user.email ?? "").trim());
    })();
    return () => {
      c = true;
    };
  }, [initialFromName, initialFromEmail, initialReplyTo]);

  async function submit() {
    setMsg(null);
    if (mode === "bulk" && source === "marketing") {
      setMsg("Bulk lists are built from Marketing → Email campaigns. This composer saves one draft at a time when wired to that flow.");
      return;
    }
    if (mode === "bulk") {
      setMsg("Bulk recipient mode is only available from marketing email campaigns.");
      return;
    }

    if (source === "crm") {
      if (!leadId) {
        setMsg("Missing lead for CRM send.");
        return;
      }
      if (!tenantId) {
        setMsg("Missing organization.");
        return;
      }
      setBusy(true);
      try {
        const res = await fetch("/api/crm/emails/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            tenantId,
            leadId,
            to: toSingle.trim().toLowerCase(),
            subject,
            preview_text: previewText || null,
            body_html: bodyHtml,
            from_name: fromName,
            from_email: fromEmail.trim().toLowerCase(),
            reply_to: replyTo.trim() || null,
          }),
        });
        const j = (await res.json()) as { ok?: boolean; error?: string; warning?: string };
        if (!res.ok) {
          setMsg(j.error ?? "Send failed");
          return;
        }
        if (j.warning) setMsg(j.warning);
        onSent?.();
      } finally {
        setBusy(false);
      }
      return;
    }

    setMsg("Sending for this source is not wired in the composer yet — use the product area or extend the submit handler.");
  }

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 560 }}>
      {msg ? (
        <p style={{ margin: 0, color: msg.includes("not wired") || msg.includes("Bulk") ? "#b42318" : "#0d6b4d", fontSize: 14 }}>{msg}</p>
      ) : null}

      {mode === "single" ? (
        <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
          To
          <input value={toSingle} onChange={(e) => setToSingle(e.target.value)} type="email" style={inp} disabled={source === "crm" && !!defaultTo} />
        </label>
      ) : (
        <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
          Recipients (one email per line)
          <textarea value={bulkLines} onChange={(e) => setBulkLines(e.target.value)} rows={6} style={{ ...inp, fontFamily: "monospace", fontSize: 13 }} />
        </label>
      )}

      <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
        Subject
        <input value={subject} onChange={(e) => setSubject(e.target.value)} style={inp} />
      </label>

      <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
        Preview text
        <input value={previewText} onChange={(e) => setPreviewText(e.target.value)} style={inp} placeholder="Inbox snippet (optional)" />
      </label>

      <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
        Body (HTML)
        <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={12} style={{ ...inp, fontFamily: "monospace", fontSize: 13 }} />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
          From name
          <input value={fromName} onChange={(e) => setFromName(e.target.value)} style={inp} />
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
          From email
          <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} type="email" style={inp} />
        </label>
      </div>

      <label style={{ display: "grid", gap: 6, fontSize: 14 }}>
        Reply-to
        <input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} type="email" style={inp} />
      </label>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
        <button type="button" onClick={() => void submit()} disabled={busy} style={btnPri}>
          {busy ? "Sending…" : mode === "single" ? "Send email" : "Next"}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={busy} style={btnSec}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
