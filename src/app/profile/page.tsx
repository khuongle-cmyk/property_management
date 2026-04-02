"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { ASSISTANT_LANGUAGES, normalizeAssistantLanguage, type SupportedAssistantLanguage } from "@/lib/voice-assistant/languages";

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<SupportedAssistantLanguage>("en");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      setEmail(user.email ?? "");
      const fromMeta = normalizeAssistantLanguage((user.user_metadata?.language as string | undefined) ?? "en");
      setLanguage(fromMeta);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function save() {
    setSaving(true);
    setMsg(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.updateUser({
      data: { language },
    });
    setSaving(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    if (typeof window !== "undefined") window.localStorage.setItem("voice.assistant.language", language);
    setMsg("Saved.");
  }

  if (loading) return <p style={{ color: "#666" }}>Loading…</p>;

  return (
    <main style={{ maxWidth: 680 }}>
      <h1 className="vw-admin-page-title" style={{ margin: "0 0 8px" }}>Profile settings</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Choose your assistant language for speech recognition and text responses.
      </p>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, marginTop: 18 }}>
        <div style={{ marginBottom: 10, color: "#334155" }}>
          Signed in as <strong>{email}</strong>
        </div>
        <label style={{ display: "grid", gap: 6, maxWidth: 320 }}>
          <span>Assistant language</span>
          <select
            value={language}
            onChange={(e) => setLanguage(normalizeAssistantLanguage(e.target.value))}
            style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: 10 }}
          >
            {ASSISTANT_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          style={{
            marginTop: 12,
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            borderRadius: 8,
            padding: "8px 12px",
            cursor: "pointer",
          }}
        >
          {saving ? "Saving…" : "Save language"}
        </button>
        {msg ? <p style={{ marginTop: 10, color: msg === "Saved." ? "#065f46" : "#b00020" }}>{msg}</p> : null}
      </div>
    </main>
  );
}
