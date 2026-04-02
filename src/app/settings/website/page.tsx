"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { CMS_TRANSLATION_TARGET_LOCALES } from "@/lib/cms2/marketing-locales";
import type { CmsWebsiteSettings } from "@/lib/cms2/types";

const input: CSSProperties = { padding: 10, borderRadius: 8, border: "1px solid #ddd", width: "100%", maxWidth: 520 };

export default function WebsiteCmsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [published, setPublished] = useState(false);
  const [settings, setSettings] = useState<CmsWebsiteSettings | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    const res = await fetch("/api/cms2/website");
    const data = (await res.json()) as { error?: string; slug?: string; published?: boolean; settings?: CmsWebsiteSettings };
    if (!res.ok) {
      setMessage(data.error ?? "Load failed");
      setLoading(false);
      return;
    }
    setSlug(data.slug ?? "");
    setPublished(Boolean(data.published));
    setSettings(data.settings ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/cms2/website", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, published, settings }),
    });
    const data = (await res.json()) as { error?: string };
    setSaving(false);
    if (!res.ok) {
      setMessage(data.error ?? "Save failed");
      return;
    }
    setMessage("Saved. Public URL: /" + slug);
  }

  async function runAi(action: "describe" | "hero_image" | "translate" | "faq") {
    setMessage(null);
    const res = await fetch("/api/cms2/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, locale: "fi", context: settings?.subheadline }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) setMessage(data.error ?? "AI request failed");
    else setMessage("AI response ready (stub).");
  }

  if (loading || !settings) {
    return <p style={{ color: "#666" }}>{loading ? "Loading…" : "No data"}</p>;
  }

  return (
    <main style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="vw-admin-page-title" style={{ margin: 0 }}>Public website (CMS 2)</h1>
        <Link href="/settings" style={{ fontSize: 14 }}>
          ← Settings
        </Link>
      </div>
      <p style={{ margin: 0, color: "#64748b" }}>
        Edit the marketing site at <code>/{slug || "your-slug"}</code> (root <code>/</code> uses{" "}
        <code>NEXT_PUBLIC_DEFAULT_PUBLIC_ORG_SLUG</code>, default <code>villageworks</code>).
      </p>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, background: "#fff" }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Publishing</h2>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          Published
        </label>
        <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
          Public slug
          <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} style={input} placeholder="acme-workspaces" />
        </label>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, background: "#fff" }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Homepage</h2>
        <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          Headline
          <input
            value={settings.headline}
            onChange={(e) => setSettings({ ...settings, headline: e.target.value })}
            style={input}
            placeholder='Workspace that works|for your business — "|" starts italic accent'
          />
        </label>
        <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          Hero eyebrow (pill above headline)
          <input
            value={settings.heroEyebrow ?? ""}
            onChange={(e) => setSettings({ ...settings, heroEyebrow: e.target.value || null })}
            style={input}
            placeholder="● Helsinki · Professional Workspaces"
          />
        </label>
        <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          Hero stats line (below CTAs)
          <input
            value={settings.heroStatsLine ?? ""}
            onChange={(e) => setSettings({ ...settings, heroStatsLine: e.target.value || null })}
            style={input}
            placeholder="5 Locations · 90%+ Occupancy · 500+ Companies"
          />
        </label>
        <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          Subheadline
          <textarea
            rows={3}
            value={settings.subheadline}
            onChange={(e) => setSettings({ ...settings, subheadline: e.target.value })}
            style={input}
          />
        </label>
        <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          Hero image URL
          <input
            value={settings.heroImageUrl ?? ""}
            onChange={(e) => setSettings({ ...settings, heroImageUrl: e.target.value || null })}
            style={input}
            placeholder="https://…"
          />
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={settings.showPrices}
            onChange={(e) => setSettings({ ...settings, showPrices: e.target.checked })}
          />
          Show prices on public site
        </label>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, background: "#fff" }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Contact &amp; SEO</h2>
        <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          Contact email (general)
          <input
            value={settings.contactEmail ?? ""}
            onChange={(e) => setSettings({ ...settings, contactEmail: e.target.value || null })}
            style={input}
            placeholder="info@…"
          />
        </label>
        <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          Sales email
          <input
            value={settings.contactSalesEmail ?? ""}
            onChange={(e) => setSettings({ ...settings, contactSalesEmail: e.target.value || null })}
            style={input}
            placeholder="sales@…"
          />
        </label>
        <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          Phone
          <input
            value={settings.contactPhone ?? ""}
            onChange={(e) => setSettings({ ...settings, contactPhone: e.target.value || null })}
            style={input}
            placeholder="+358 …"
          />
        </label>
        <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          SEO description
          <textarea
            rows={2}
            value={settings.seoDescription ?? ""}
            onChange={(e) => setSettings({ ...settings, seoDescription: e.target.value || null })}
            style={input}
          />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          CRM pipeline slug (optional)
          <input
            value={settings.pipelineSlug ?? ""}
            onChange={(e) => setSettings({ ...settings, pipelineSlug: e.target.value || null })}
            style={input}
            placeholder="from CRM pipeline settings"
          />
        </label>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, background: "#fff" }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>AI (stubs)</h2>
        <p style={{ marginTop: 0, color: "#64748b", fontSize: 14 }}>Requires API keys; returns 501 until wired.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" onClick={() => void runAi("describe")} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd" }}>
            Generate description
          </button>
          <button type="button" onClick={() => void runAi("hero_image")} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd" }}>
            Generate hero (DALL·E)
          </button>
          <button type="button" onClick={() => void runAi("translate")} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd" }}>
            Translate all (FI, EN, SV, NO, DA, ES, FR)
          </button>
          <button type="button" onClick={() => void runAi("faq")} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd" }}>
            Generate FAQ
          </button>
        </div>
      </section>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "#1a5c5a", color: "#fff", fontWeight: 600 }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {message ? <span style={{ fontSize: 14, color: message.startsWith("Saved") ? "#166534" : "#b91c1c" }}>{message}</span> : null}
      </div>
    </main>
  );
}
