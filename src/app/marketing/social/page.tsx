"use client";

import { useEffect, useState } from "react";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";
type Post = {
  id: string;
  platform: string;
  content_text: string | null;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
};

export default function MarketingSocialPage() {
  const { tenantId, querySuffix, dataReady, allOrganizations } = useMarketingTenant();
  const [posts, setPosts] = useState<Post[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [platform, setPlatform] = useState("linkedin");
  const [caption, setCaption] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dataReady) return;
    let c = false;
    void (async () => {
      const res = await fetch(`/api/marketing/social/posts${querySuffix}`, { cache: "no-store" });
      const j = (await res.json()) as { posts?: Post[]; error?: string };
      if (!c) {
        if (!res.ok) setErr(j.error ?? "Failed");
        else setPosts(j.posts ?? []);
      }
    })();
    return () => {
      c = true;
    };
  }, [dataReady, querySuffix]);

  async function aiCaption() {
    if (allOrganizations || !tenantId) return;
    setBusy(true);
    const res = await fetch("/api/marketing/ai/email-body", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, template: "newsletter", audience: "social", topic: caption || "workspace highlight" }),
    });
    const j = (await res.json()) as { html?: string; error?: string };
    setBusy(false);
    if (res.ok && j.html) {
      const plain = j.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      setCaption(plain.slice(0, 2200));
    }
  }

  async function saveDraft() {
    if (allOrganizations || !tenantId) return;
    setBusy(true);
    const res = await fetch("/api/marketing/social/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        platform,
        content_text: caption,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        status: scheduledAt ? "scheduled" : "draft",
      }),
    });
    const j = (await res.json()) as { error?: string };
    setBusy(false);
    if (!res.ok) setErr(j.error ?? "Save failed");
    else {
      setCaption("");
      setScheduledAt("");
      const r2 = await fetch(`/api/marketing/social/posts${querySuffix}`, { cache: "no-store" });
      const j2 = (await r2.json()) as { posts?: Post[] };
      setPosts(j2.posts ?? []);
    }
  }

  if (!dataReady) return null;

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 720 }}>
      <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Social media</h2>
      <p style={{ margin: 0, fontSize: 14, opacity: 0.85 }}>
        OAuth connections (Instagram, LinkedIn, Facebook) and publishing APIs are not wired in this build — create drafts and scheduled rows here; connect tokens via{" "}
        <code>marketing_social_connections</code> and env placeholders from the spec.
      </p>
      {err ? <p style={{ color: "#b42318" }}>{err}</p> : null}

      {allOrganizations ? (
        <p style={{ margin: 0, fontSize: 14, color: "rgba(26,74,74,0.8)" }}>
          Select a single organization above to create social drafts.
        </p>
      ) : null}

      <div style={{ background: "#fff", padding: 20, borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)", display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Create post</h3>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ padding: 10, borderRadius: 8 }}>
          <option value="instagram">Instagram</option>
          <option value="linkedin">LinkedIn</option>
          <option value="facebook">Facebook</option>
        </select>
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={6} placeholder="Caption" style={{ padding: 12, borderRadius: 8 }} />
        <button type="button" onClick={() => void aiCaption()} disabled={busy} style={{ justifySelf: "start", padding: "8px 14px", borderRadius: 8 }}>
          AI generate caption
        </button>
        <label style={{ display: "grid", gap: 6 }}>
          Schedule (optional)
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} style={{ padding: 10, borderRadius: 8 }} />
        </label>
        <button
          type="button"
          onClick={() => void saveDraft()}
          disabled={busy || allOrganizations}
          style={{ padding: "10px 18px", borderRadius: 8, background: "var(--petrol)", color: "#fff", border: "none", cursor: "pointer" }}
        >
          Save
        </button>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(26,74,74,0.12)" }}>
              <th style={{ padding: 12 }}>Platform</th>
              <th style={{ padding: 12 }}>Status</th>
              <th style={{ padding: 12 }}>Scheduled</th>
              <th style={{ padding: 12 }}>Preview</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid rgba(26,74,74,0.06)" }}>
                <td style={{ padding: 12 }}>{p.platform}</td>
                <td style={{ padding: 12 }}>{p.status}</td>
                <td style={{ padding: 12 }}>{p.scheduled_at ? new Date(p.scheduled_at).toLocaleString() : "—"}</td>
                <td style={{ padding: 12, maxWidth: 280 }}>{(p.content_text ?? "").slice(0, 100)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
        {posts.length === 0 ? <p style={{ padding: 16 }}>No posts yet.</p> : null}
      </div>
    </div>
  );
}
