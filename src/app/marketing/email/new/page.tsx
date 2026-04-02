"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";

const TEMPLATES: Record<string, string> = {
  welcome: "<p>Welcome — we're glad you're part of our community.</p><p>Here's what to expect in your first week…</p>",
  newsletter: "<p>This month at our spaces: updates, events, and member stories.</p><ul><li>Highlight one</li><li>Highlight two</li></ul>",
  offer: "<p>A limited offer for you: save on your next booking when you reply before the deadline.</p>",
  event_invite: "<p>You're invited to our upcoming event. Reserve your spot — spaces are limited.</p>",
  reengagement: "<p>We haven't heard from you in a while. We'd love to welcome you back with a special rate.</p>",
  custom: "<p></p>",
};

function NewEmailCampaignPage() {
  const router = useRouter();
  const search = useSearchParams();
  const editId = search.get("id");
  const { tenantId, tenants, querySuffix, loading: ctxLoading, dataReady, allOrganizations } = useMarketingTenant();

  const [step, setStep] = useState(1);
  const [emailId, setEmailId] = useState<string | null>(editId);
  const [subject, setSubject] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [campaignType, setCampaignType] = useState<"newsletter" | "promotional" | "transactional">("newsletter");
  const [templateId, setTemplateId] = useState("newsletter");
  const [bodyHtml, setBodyHtml] = useState(TEMPLATES.newsletter);
  const [audience, setAudience] = useState("all_leads");
  const [customEmails, setCustomEmails] = useState("");
  const [spaceType, setSpaceType] = useState("office");
  const [propertyId, setPropertyId] = useState("");
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!editId);

  useEffect(() => {
    if (!dataReady) return;
    const ids = tenants.map((t) => t.id);
    if (!ids.length) return;
    const supabase = getSupabaseClient();
    const q = tenantId
      ? supabase.from("properties").select("id,name").eq("tenant_id", tenantId)
      : supabase.from("properties").select("id,name").in("tenant_id", ids);
    void q.order("name", { ascending: true }).then(({ data }) => setProperties((data as { id: string; name: string }[]) ?? []));
  }, [dataReady, tenantId, tenants]);

  useEffect(() => {
    if (!editId) {
      setLoaded(true);
      return;
    }
    let c = false;
    (async () => {
      const res = await fetch(`/api/marketing/emails/${editId}`, { cache: "no-store" });
      const j = (await res.json()) as { email?: Record<string, string | null>; error?: string };
      if (c) return;
      if (!res.ok) {
        setMsg(j.error ?? "Failed to load");
        setLoaded(true);
        return;
      }
      const e = j.email!;
      setEmailId(String(e.id));
      setSubject(String(e.subject ?? ""));
      setPreviewText(String(e.preview_text ?? ""));
      setFromName(String(e.from_name ?? ""));
      setFromEmail(String(e.from_email ?? ""));
      setReplyTo(String(e.reply_to ?? ""));
      const ct = String((e as { campaign_type?: string | null }).campaign_type ?? "").trim();
      if (ct === "newsletter" || ct === "promotional" || ct === "transactional") {
        setCampaignType(ct);
      }
      setTemplateId(String(e.template_id ?? "custom"));
      setBodyHtml(String(e.body_html ?? "<p></p>"));
      setLoaded(true);
    })();
    return () => {
      c = true;
    };
  }, [editId]);

  async function ensureEmail(): Promise<string | null> {
    if (emailId) return emailId;
    if (!allOrganizations && !tenantId) return null;
    const payload: Record<string, unknown> = {
      campaign_type: campaignType,
      subject,
      preview_text: previewText || null,
      body_html: bodyHtml,
      from_name: fromName || null,
      from_email: fromEmail || null,
      reply_to: replyTo || null,
      template_id: templateId,
    };
    if (allOrganizations) payload.allOrganizations = true;
    else payload.tenantId = tenantId;
    const res = await fetch("/api/marketing/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = (await res.json()) as { email?: { id: string }; error?: string };
    if (!res.ok) {
      setMsg(j.error ?? "Create failed");
      return null;
    }
    const id = j.email!.id;
    setEmailId(id);
    return id;
  }

  async function savePatch(partial: Record<string, unknown>) {
    const id = await ensureEmail();
    if (!id) return false;
    const res = await fetch(`/api/marketing/emails/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    const j = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMsg(j.error ?? "Save failed");
      return false;
    }
    return true;
  }

  async function aiSubject() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/marketing/ai/email-subject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: tenantId || undefined, context: previewText || templateId || "marketing email" }),
    });
    const j = (await res.json()) as { subject?: string; error?: string };
    setBusy(false);
    if (!res.ok) setMsg(j.error ?? "AI failed");
    else if (j.subject) setSubject(j.subject);
  }

  async function aiBody() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/marketing/ai/email-body", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenantId || undefined,
        template: templateId,
        audience,
        topic: previewText || subject || "workspace update",
      }),
    });
    const j = (await res.json()) as { html?: string; error?: string };
    setBusy(false);
    if (!res.ok) setMsg(j.error ?? "AI failed");
    else if (j.html) setBodyHtml(j.html);
  }

  async function nextFromRecipients() {
    const id = await ensureEmail();
    if (!id) return;
    const payload: Record<string, unknown> = { audience };
    if (audience === "custom_list") {
      payload.emails = customEmails.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    }
    if (audience === "by_space_type") payload.space_type = spaceType;
    if (audience === "by_property") payload.property_id = propertyId;

    setBusy(true);
    const res = await fetch(`/api/marketing/emails/${id}/recipients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = (await res.json()) as { count?: number; error?: string };
    setBusy(false);
    if (!res.ok) {
      setMsg(j.error ?? "Recipients failed");
      return;
    }
    setMsg(`Recipient list: ${j.count ?? 0} contacts`);
    setStep(4);
  }

  async function finishSend() {
    const id = emailId ?? (await ensureEmail());
    if (!id) return;
    if (scheduleMode === "later" && scheduledAt) {
      setBusy(true);
      const ok = await savePatch({ scheduled_at: new Date(scheduledAt).toISOString(), status: "scheduled" });
      setBusy(false);
      if (ok) {
        setMsg("Scheduled. Sending uses Resend when you trigger send from ops (scheduled dispatch not automated in this build).");
        router.push(`/marketing/email${querySuffix}`);
      }
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/marketing/emails/${id}/send`, { method: "POST" });
    const j = (await res.json()) as { sent?: number; failed?: number; errors?: string[]; error?: string };
    setBusy(false);
    if (!res.ok) {
      setMsg(j.error ?? "Send failed");
      return;
    }
    setMsg(`Sent: ${j.sent}, failed: ${j.failed}`);
    router.push(`/marketing/email${querySuffix}`);
  }

  if (ctxLoading || !dataReady) return null;
  if (!loaded) return <p>Loading draft…</p>;

  const stepStyle = (n: number) => ({
    padding: "8px 12px",
    borderRadius: 8,
    background: step === n ? "var(--petrol, #1a4a4a)" : "rgba(26,74,74,0.08)",
    color: step === n ? "#fff" : "inherit",
    fontSize: 13,
  });

  return (
    <div style={{ maxWidth: 720, display: "grid", gap: 20 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={stepStyle(1)}>1 Setup</span>
        <span style={stepStyle(2)}>2 Design</span>
        <span style={stepStyle(3)}>3 Recipients</span>
        <span style={stepStyle(4)}>4 Schedule</span>
      </div>
      <Link href={`/marketing/email${querySuffix}`} style={{ fontSize: 14 }}>
        ← Back to list
      </Link>
      {msg ? <p style={{ color: msg.startsWith("Sent") || msg.includes("Recipient") ? "#0d6b4d" : "#b42318" }}>{msg}</p> : null}

      {step === 1 ? (
        <div style={{ display: "grid", gap: 12, background: "#fff", padding: 20, borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Email type</span>
            <select
              value={campaignType}
              onChange={(e) => setCampaignType(e.target.value as "newsletter" | "promotional" | "transactional")}
              style={inp}
            >
              <option value="newsletter">Newsletter</option>
              <option value="promotional">Promotional</option>
              <option value="transactional">Transactional</option>
            </select>
          </label>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>
            Classifies the send (newsletter, promotional, or transactional). Use a real campaign UUID only when linking to Marketing → Campaigns.
          </p>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Subject</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} style={{ ...inp, flex: 1, minWidth: 200 }} />
              <button type="button" onClick={() => void aiSubject()} disabled={busy} style={btnSec}>
                AI suggest
              </button>
            </div>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Preview text</span>
            <input value={previewText} onChange={(e) => setPreviewText(e.target.value)} style={inp} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>From name</span>
            <input value={fromName} onChange={(e) => setFromName(e.target.value)} style={inp} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>From email</span>
            <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} type="email" style={inp} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Reply-to</span>
            <input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} type="email" style={inp} />
          </label>
          <button
            type="button"
            onClick={() =>
              void savePatch({
                subject,
                preview_text: previewText,
                from_name: fromName,
                from_email: fromEmail,
                reply_to: replyTo,
                campaign_type: campaignType,
              }).then((ok) => ok && setStep(2))
            }
            disabled={busy}
            style={btnPri}
          >
            Continue
          </button>
        </div>
      ) : null}

      {step === 2 ? (
        <div style={{ display: "grid", gap: 12, background: "#fff", padding: 20, borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Template</span>
            <select
              value={templateId}
              onChange={(e) => {
                const v = e.target.value;
                setTemplateId(v);
                if (v !== "custom") setBodyHtml(TEMPLATES[v] ?? TEMPLATES.custom);
              }}
              style={inp}
            >
              <option value="welcome">Welcome new tenant</option>
              <option value="newsletter">Monthly newsletter</option>
              <option value="offer">Special offer</option>
              <option value="event_invite">Event invitation</option>
              <option value="reengagement">Re-engagement</option>
              <option value="custom">Custom (blank)</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Body (HTML)</span>
            <textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={14} style={{ ...inp, fontFamily: "monospace", fontSize: 13 }} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void aiBody()} disabled={busy} style={btnSec}>
              Generate with AI
            </button>
            <button type="button" onClick={() => void savePatch({ body_html: bodyHtml, template_id: templateId }).then((ok) => ok && setStep(3))} style={btnPri}>
              Continue
            </button>
            <button type="button" onClick={() => setStep(1)} style={btnSec}>
              Back
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div style={{ display: "grid", gap: 12, background: "#fff", padding: 20, borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)" }}>
          <p style={{ margin: 0, fontSize: 14, opacity: 0.85 }}>Unsubscribed contacts are always excluded.</p>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Audience</span>
            <select value={audience} onChange={(e) => setAudience(e.target.value)} style={inp}>
              <option value="all_leads">All leads</option>
              <option value="all_tenants">All tenants (won)</option>
              <option value="all_contacts">All contacts (non-archived)</option>
              <option value="by_space_type">By space type interest</option>
              <option value="by_property">By property</option>
              <option value="custom_list">Custom list</option>
            </select>
          </label>
          {audience === "by_space_type" ? (
            <input value={spaceType} onChange={(e) => setSpaceType(e.target.value)} placeholder="e.g. office" style={inp} />
          ) : null}
          {audience === "by_property" ? (
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} style={inp}>
              <option value="">Select property</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          {audience === "custom_list" ? (
            <textarea value={customEmails} onChange={(e) => setCustomEmails(e.target.value)} placeholder="one@email.com per line" rows={6} style={inp} />
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void nextFromRecipients()} disabled={busy} style={btnPri}>
              Build list & continue
            </button>
            <button type="button" onClick={() => setStep(2)} style={btnSec}>
              Back
            </button>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div style={{ display: "grid", gap: 12, background: "#fff", padding: 20, borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="radio" checked={scheduleMode === "now"} onChange={() => setScheduleMode("now")} />
            Send now (Resend)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="radio" checked={scheduleMode === "later"} onChange={() => setScheduleMode("later")} />
            Schedule (stores time; use send when ready)
          </label>
          {scheduleMode === "later" ? (
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} style={inp} />
          ) : null}
          <p style={{ fontSize: 13, opacity: 0.75, margin: 0 }}>
            Best send time: analyze historical opens in a future iteration; for now pick a weekday morning in your timezone.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void finishSend()} disabled={busy} style={btnPri}>
              {scheduleMode === "now" ? "Send" : "Save schedule"}
            </button>
            <button type="button" onClick={() => setStep(3)} style={btnSec}>
              Back
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const inp: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid rgba(26,74,74,0.25)",
};

const btnPri: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--petrol, #1a4a4a)",
  color: "#fff",
  cursor: "pointer",
};

const btnSec: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 8,
  border: "1px solid rgba(26,74,74,0.3)",
  background: "#fff",
  cursor: "pointer",
};

export default function MarketingEmailNewPage() {
  return (
    <Suspense fallback={<p style={{ opacity: 0.8 }}>Loading…</p>}>
      <NewEmailCampaignPage />
    </Suspense>
  );
}
