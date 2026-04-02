"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/browser";

export default function InviteAcceptPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!cancelled) {
        setHasSession(!!session);
        setEmail(session?.user?.email ?? null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const passwordOk = useMemo(() => password.length >= 8, [password]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!hasSession) {
      setError("Invite session not found. Please open the invite link from your email.");
      return;
    }
    if (!passwordOk) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    const supabase = getSupabaseClient();
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    setMessage("Password set. Redirecting…");
    setTimeout(() => router.replace("/"), 900);
  }

  if (loading) return <p>Loading invite…</p>;

  return (
    <main style={{ maxWidth: 460, margin: "30px auto" }}>
      <h1 className="vw-admin-page-title" style={{ margin: "0 0 8px" }}>Set your password</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        {email ? `Invited as ${email}.` : "Use your invite link to activate your account."}
      </p>

      {!hasSession ? (
        <p style={{ color: "#b00020" }}>
          Invite session not found. Please open the full invite link from your email.
        </p>
      ) : (
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 14 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>New password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Confirm password</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </label>

          <button
            type="submit"
            disabled={saving}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Set password and continue"}
          </button>
        </form>
      )}

      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}
      {message ? <p style={{ color: "#1b5e20" }}>{message}</p> : null}
    </main>
  );
}

