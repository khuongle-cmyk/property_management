"use client";

import { useEffect, useMemo, useState } from "react";
import BrandLivePreview from "@/components/BrandLivePreview";
import { DEFAULT_BRAND } from "@/lib/brand/default";
import { displayTenantLabel } from "@/lib/reports/admin-fee-constants";
import type { BrandSettings } from "@/lib/brand/types";
import { formatDate } from "@/lib/date/format";

type BrandRow = BrandSettings & { id?: string; tenant_id?: string; tenants?: { name?: string } | null; created_at?: string };
type TenantRow = { id: string; name: string };

export default function SuperAdminBrandsPage() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [form, setForm] = useState<BrandRow>({ ...DEFAULT_BRAND, tenant_id: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [testDomain, setTestDomain] = useState("");

  async function load() {
    const [bRes, tRes] = await Promise.all([
      fetch("/api/super-admin/brands"),
      fetch("/api/super-admin/brands-tenants"),
    ]);
    const b = (await bRes.json()) as { brands?: BrandRow[]; error?: string };
    const t = (await tRes.json()) as { tenants?: TenantRow[] };
    if (!bRes.ok) {
      setMsg(b.error ?? "Failed to load brands");
      return;
    }
    setBrands(b.brands ?? []);
    setTenants(t.tenants ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  const preview = useMemo(() => ({ ...DEFAULT_BRAND, ...form }), [form]);

  async function save() {
    setMsg(null);
    const r = await fetch("/api/super-admin/brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = (await r.json()) as { error?: string };
    if (!r.ok) {
      setMsg(j.error ?? "Save failed");
      return;
    }
    setMsg("Brand saved.");
    await load();
  }

  function testDomainMapping() {
    const d = testDomain.trim().toLowerCase();
    if (!d) {
      setMsg("Enter a domain to test.");
      return;
    }
    const exists = brands.some((b) => String(b.custom_domain ?? "").toLowerCase() === d && b.is_active);
    setMsg(exists ? `Domain mapped and active: ${d}` : `No active mapping found for ${d}`);
  }

  return (
    <main style={{ display: "grid", gap: 12 }}>
      <h1 className="vw-admin-page-title" style={{ margin: 0 }}>White-label brands</h1>
      <section style={{ border: "1px solid #dce8e8", borderRadius: 12, background: "#fff", padding: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Brand list</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Brand", "Domain", "Status", "Organization", "Created"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e8efef" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => (
              <tr key={String(b.id ?? b.tenant_id)}>
                <td style={{ padding: 6, borderBottom: "1px solid #f0f5f5" }}>{b.brand_name}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #f0f5f5" }}>{b.custom_domain ?? "—"}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #f0f5f5" }}>{b.is_active ? "active" : "inactive"}</td>
                <td style={{ padding: 6, borderBottom: "1px solid #f0f5f5" }}>
                  {b.tenants?.name != null && String(b.tenants.name).trim() !== ""
                    ? displayTenantLabel(b.tenants.name)
                    : (b.tenant_id ?? "—")}
                </td>
                <td style={{ padding: 6, borderBottom: "1px solid #f0f5f5" }}>{b.created_at ? formatDate(b.created_at) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
        <div style={{ border: "1px solid #dce8e8", borderRadius: 12, background: "#fff", padding: 12, display: "grid", gap: 8 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Add / edit brand</h2>
          <label>
            Organization
            <select value={form.tenant_id ?? ""} onChange={(e) => setForm((s) => ({ ...s, tenant_id: e.target.value }))} style={{ width: "100%" }}>
              <option value="">Select organization…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {displayTenantLabel(t.name)}
                </option>
              ))}
            </select>
          </label>
          <label>Brand name <input value={form.brand_name} onChange={(e) => setForm((s) => ({ ...s, brand_name: e.target.value }))} style={{ width: "100%" }} /></label>
          <label>Custom domain <input value={form.custom_domain ?? ""} onChange={(e) => setForm((s) => ({ ...s, custom_domain: e.target.value }))} style={{ width: "100%" }} /></label>
          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            <label style={{ flex: 1 }}>
              Test domain
              <input value={testDomain} onChange={(e) => setTestDomain(e.target.value)} placeholder="app.theirdomain.com" style={{ width: "100%" }} />
            </label>
            <button type="button" onClick={testDomainMapping}>Test domain</button>
          </div>
          <label>Logo URL <input value={form.logo_url ?? ""} onChange={(e) => setForm((s) => ({ ...s, logo_url: e.target.value }))} style={{ width: "100%" }} /></label>
          <label>White logo URL <input value={form.logo_white_url ?? ""} onChange={(e) => setForm((s) => ({ ...s, logo_white_url: e.target.value }))} style={{ width: "100%" }} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(120px,1fr))", gap: 8 }}>
            <label>Primary <input type="color" value={form.primary_color} onChange={(e) => setForm((s) => ({ ...s, primary_color: e.target.value }))} /></label>
            <label>Secondary <input type="color" value={form.secondary_color} onChange={(e) => setForm((s) => ({ ...s, secondary_color: e.target.value }))} /></label>
            <label>Sidebar <input type="color" value={form.sidebar_color} onChange={(e) => setForm((s) => ({ ...s, sidebar_color: e.target.value }))} /></label>
          </div>
          <label>Login headline <input value={form.login_page_headline ?? ""} onChange={(e) => setForm((s) => ({ ...s, login_page_headline: e.target.value }))} style={{ width: "100%" }} /></label>
          <label>Login subheadline <input value={form.login_page_subheadline ?? ""} onChange={(e) => setForm((s) => ({ ...s, login_page_subheadline: e.target.value }))} style={{ width: "100%" }} /></label>
          <label>Email sender name <input value={form.email_sender_name ?? ""} onChange={(e) => setForm((s) => ({ ...s, email_sender_name: e.target.value }))} style={{ width: "100%" }} /></label>
          <label>Email sender address <input value={form.email_sender_address ?? ""} onChange={(e) => setForm((s) => ({ ...s, email_sender_address: e.target.value }))} style={{ width: "100%" }} /></label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={!!form.is_active} onChange={(e) => setForm((s) => ({ ...s, is_active: e.target.checked }))} />
            Active
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={!!form.hide_powered_by} onChange={(e) => setForm((s) => ({ ...s, hide_powered_by: e.target.checked }))} />
            Hide powered by text
          </label>
          <button type="button" onClick={() => void save()}>Save brand</button>
          {msg ? <p style={{ margin: 0, color: "#1e3a8a" }}>{msg}</p> : null}
          <div style={{ borderTop: "1px solid #e9f1f1", paddingTop: 8, fontSize: 13, color: "#4f6666" }}>
            <strong>Domain setup instructions</strong>
            <p style={{ margin: "6px 0" }}>
              Ask your customer to add this DNS record:<br />
              Type: CNAME<br />
              Name: app<br />
              Value: yourdomain.vercel.app
            </p>
            <p style={{ margin: "6px 0" }}>
              Then add the domain in Vercel project settings, and click Verify Domain.
            </p>
          </div>
        </div>
        <BrandLivePreview brand={preview} />
      </section>
    </main>
  );
}

