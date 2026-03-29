"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";
import { pathWithMarketingScope } from "@/lib/marketing/access";

export default function NewSmsPage() {
  const router = useRouter();
  const { tenantId, querySuffix, loading: ctxLoading, dataReady, allOrganizations } = useMarketingTenant();
  const [text, setText] = useState("");
  const [audience, setAudience] = useState("all_leads");
  const [customPhones, setCustomPhones] = useState("");
  const [spaceType, setSpaceType] = useState("office");
  const [propertyId, setPropertyId] = useState("");
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    void getSupabaseClient()
      .from("properties")
      .select("id,name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true })
      .then(({ data }) => setProperties((data as { id: string; name: string }[]) ?? []));
  }, [tenantId]);

  async function aiSms() {
    if (allOrganizations || !tenantId) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/marketing/ai/sms-body", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, topic: text || "promotion", audience }),
    });
    const j = (await res.json()) as { text?: string; error?: string };
    setBusy(false);
    if (!res.ok) setMsg(j.error ?? "AI failed");
    else if (j.text) setText(j.text);
  }

  async function submit() {
    if (!tenantId || !text.trim()) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/marketing/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, message_text: text.trim() }),
    });
    const j = (await res.json()) as { sms?: { id: string }; error?: string };
    if (!res.ok) {
      setBusy(false);
      setMsg(j.error ?? "Failed");
      return;
    }
    const id = j.sms!.id;
    const payload: Record<string, unknown> = { audience };
    if (audience === "custom_list") payload.phones = customPhones.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (audience === "by_space_type") payload.space_type = spaceType;
    if (audience === "by_property") payload.property_id = propertyId;

    const r2 = await fetch(`/api/marketing/sms/${id}/recipients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j2 = (await r2.json()) as { count?: number; error?: string };
    if (!r2.ok) {
      setBusy(false);
      setMsg(j2.error ?? "Recipients failed");
      return;
    }
    if ((j2.count ?? 0) === 0) {
      setBusy(false);
      setMsg("No recipients with phone numbers for this audience.");
      return;
    }
    const r3 = await fetch(`/api/marketing/sms/${id}/send`, { method: "POST" });
    const j3 = (await r3.json()) as { error?: string; delivered?: number };
    setBusy(false);
    if (!r3.ok) setMsg(j3.error ?? "Send failed — check Twilio env");
    else {
      setMsg(`Sent. Delivered: ${j3.delivered ?? 0}`);
      router.push(pathWithMarketingScope("/marketing/sms", querySuffix));
    }
  }

  if (ctxLoading || !dataReady) return null;
  if (allOrganizations) {
    return (
      <div style={{ maxWidth: 560, display: "grid", gap: 16 }}>
        <p style={{ margin: 0, fontSize: 15, color: "rgba(26,74,74,0.85)" }}>
          Select a single organization in the header to send SMS.
        </p>
        <Link href={pathWithMarketingScope("/marketing/sms", querySuffix)}>← Back</Link>
      </div>
    );
  }
  if (!tenantId) return null;

  const len = text.length;
  const warn = len > 160;

  return (
    <div style={{ maxWidth: 560, display: "grid", gap: 16 }}>
      <Link href={pathWithMarketingScope("/marketing/sms", querySuffix)}>← Back</Link>
      <h2 style={{ margin: 0, fontSize: "1.25rem" }}>New SMS</h2>
      {msg ? <p style={{ color: msg.includes("Sent") ? "#0d6b4d" : "#b42318" }}>{msg}</p> : null}
      <label style={{ display: "grid", gap: 6 }}>
        Message ({len} chars{warn ? " — long; multi-segment rates apply" : ""})
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} style={{ padding: 12, borderRadius: 8, border: "1px solid rgba(26,74,74,0.25)" }} maxLength={480} />
      </label>
      <button type="button" onClick={() => void aiSms()} disabled={busy} style={{ justifySelf: "start", padding: "8px 14px", borderRadius: 8, cursor: "pointer" }}>
        AI generate
      </button>
      <label style={{ display: "grid", gap: 6 }}>
        Recipients
        <select value={audience} onChange={(e) => setAudience(e.target.value)} style={{ padding: 10, borderRadius: 8 }}>
          <option value="all_leads">All leads (with phone)</option>
          <option value="all_tenants">Tenants (won)</option>
          <option value="all_contacts">All contacts</option>
          <option value="by_space_type">By space type</option>
          <option value="by_property">By property</option>
          <option value="custom_list">Custom numbers</option>
        </select>
      </label>
      {audience === "by_space_type" ? (
        <input value={spaceType} onChange={(e) => setSpaceType(e.target.value)} style={{ padding: 10, borderRadius: 8 }} />
      ) : null}
      {audience === "by_property" ? (
        <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} style={{ padding: 10, borderRadius: 8 }}>
          <option value="">Property</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : null}
      {audience === "custom_list" ? (
        <textarea value={customPhones} onChange={(e) => setCustomPhones(e.target.value)} placeholder="+358…" rows={4} style={{ padding: 12, borderRadius: 8 }} />
      ) : null}
      <button type="button" onClick={() => void submit()} disabled={busy} style={{ padding: "12px 20px", borderRadius: 8, background: "var(--petrol)", color: "#fff", border: "none", cursor: "pointer" }}>
        Build list & send
      </button>
    </div>
  );
}
