"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import BrandLivePreview from "@/components/BrandLivePreview";
import { DEFAULT_BRAND } from "@/lib/brand/default";
import type { BrandPlan, BrandSettings } from "@/lib/brand/types";

type Payload = { plan?: BrandPlan; brand?: BrandSettings; error?: string };

export default function BrandSettingsPage() {
  const [plan, setPlan] = useState<BrandPlan>("starter");
  const [form, setForm] = useState<BrandSettings>(DEFAULT_BRAND);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/settings/brand");
    const j = (await r.json()) as Payload;
    if (!r.ok) {
      setMsg(j.error ?? "Failed to load brand settings");
      return;
    }
    setPlan(j.plan ?? "starter");
    setForm((j.brand as BrandSettings) ?? DEFAULT_BRAND);
  }

  useEffect(() => {
    void load();
  }, []);

  const preview = useMemo(() => ({ ...DEFAULT_BRAND, ...form }), [form]);

  async function save() {
    setMsg(null);
    const r = await fetch("/api/settings/brand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = (await r.json()) as { error?: string };
    if (!r.ok) {
      setMsg(j.error ?? "Save failed");
      return;
    }
    setMsg("Brand settings saved.");
  }

  if (plan === "starter") {
    return (
      <main style={{ display: "grid", gap: 12 }}>
        <h1 className="vw-admin-page-title" style={{ margin: 0 }}>Brand settings</h1>
        <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Upgrade required</h2>
          <p style={{ color: "#64748b" }}>
            White-label branding is available on Professional and Enterprise plans.
          </p>
          <p style={{ margin: 0, color: "#334155", fontSize: 13 }}>
            Current plan: <strong>{plan}</strong>
          </p>
        </section>
        <Link href="/settings">Back to settings</Link>
      </main>
    );
  }

  return (
    <main style={{ display: "grid", gap: 12 }}>
      <h1 className="vw-admin-page-title" style={{ margin: 0 }}>Brand settings</h1>
      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff", display: "grid", gap: 8 }}>
        <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
          Plan: <strong>{plan}</strong>
        </p>
        <label>App name <input value={form.brand_name} onChange={(e) => setForm((s) => ({ ...s, brand_name: e.target.value }))} style={{ width: "100%" }} /></label>
        <label>Logo URL <input value={form.logo_url ?? ""} onChange={(e) => setForm((s) => ({ ...s, logo_url: e.target.value }))} style={{ width: "100%" }} /></label>
        <label>White logo URL <input value={form.logo_white_url ?? ""} onChange={(e) => setForm((s) => ({ ...s, logo_white_url: e.target.value }))} style={{ width: "100%" }} /></label>
        <label>Favicon URL <input value={form.favicon_url ?? ""} onChange={(e) => setForm((s) => ({ ...s, favicon_url: e.target.value }))} style={{ width: "100%" }} /></label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(100px,1fr))", gap: 8 }}>
          <label>Primary <input type="color" value={form.primary_color} onChange={(e) => setForm((s) => ({ ...s, primary_color: e.target.value }))} /></label>
          <label>Secondary <input type="color" value={form.secondary_color} onChange={(e) => setForm((s) => ({ ...s, secondary_color: e.target.value }))} /></label>
          <label>Sidebar <input type="color" value={form.sidebar_color} onChange={(e) => setForm((s) => ({ ...s, sidebar_color: e.target.value }))} /></label>
          <label>Background <input type="color" value={form.background_color} onChange={(e) => setForm((s) => ({ ...s, background_color: e.target.value }))} /></label>
          <label>Accent <input type="color" value={form.accent_color} onChange={(e) => setForm((s) => ({ ...s, accent_color: e.target.value }))} /></label>
        </div>
        <label>Login headline <input value={form.login_page_headline ?? ""} onChange={(e) => setForm((s) => ({ ...s, login_page_headline: e.target.value }))} style={{ width: "100%" }} /></label>
        <label>Login subheadline <input value={form.login_page_subheadline ?? ""} onChange={(e) => setForm((s) => ({ ...s, login_page_subheadline: e.target.value }))} style={{ width: "100%" }} /></label>
        <label>Login background image URL <input value={form.login_page_background_image_url ?? ""} onChange={(e) => setForm((s) => ({ ...s, login_page_background_image_url: e.target.value }))} style={{ width: "100%" }} /></label>
        <label>Support email <input value={form.support_email ?? ""} onChange={(e) => setForm((s) => ({ ...s, support_email: e.target.value }))} style={{ width: "100%" }} /></label>
        <label>Support phone <input value={form.support_phone ?? ""} onChange={(e) => setForm((s) => ({ ...s, support_phone: e.target.value }))} style={{ width: "100%" }} /></label>
        <label>Support URL <input value={form.support_url ?? ""} onChange={(e) => setForm((s) => ({ ...s, support_url: e.target.value }))} style={{ width: "100%" }} /></label>
        <button type="button" onClick={() => void save()} style={{ width: "fit-content" }}>Save brand settings</button>
        {msg ? <p style={{ margin: 0, color: "#1e3a8a" }}>{msg}</p> : null}
      </section>
      <BrandLivePreview brand={preview} />
    </main>
  );
}

