"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";
import { pathWithMarketingScope } from "@/lib/marketing/access";

export default function NewEventPage() {
  const router = useRouter();
  const { tenantId, querySuffix, loading: ctxLoading, dataReady, allOrganizations } = useMarketingTenant();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [eventType, setEventType] = useState("networking");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");
  const [maxAtt, setMaxAtt] = useState("");
  const [price, setPrice] = useState("0");
  const [status, setStatus] = useState("draft");
  const [isPublic, setIsPublic] = useState(true);
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

  async function submit() {
    if (allOrganizations || !tenantId || !name.trim() || !start || !end) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/marketing/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        name: name.trim(),
        description: description || null,
        event_type: eventType,
        start_datetime: new Date(start).toISOString(),
        end_datetime: new Date(end).toISOString(),
        location: location || null,
        max_attendees: maxAtt ? Number(maxAtt) : null,
        price: Number(price) || 0,
        status,
        is_public: isPublic,
        property_id: propertyId || null,
      }),
    });
    const j = (await res.json()) as { event?: { id: string }; error?: string };
    setBusy(false);
    if (!res.ok) setMsg(j.error ?? "Failed");
    else router.push(pathWithMarketingScope(`/marketing/events/${j.event!.id}`, querySuffix));
  }

  if (ctxLoading || !dataReady) return null;
  if (allOrganizations) {
    return (
      <div style={{ maxWidth: 560, display: "grid", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 15, color: "rgba(26,74,74,0.85)" }}>
          Select a single organization in the header to create an event.
        </p>
        <Link href={pathWithMarketingScope("/marketing/events", querySuffix)}>← Back</Link>
      </div>
    );
  }
  if (!tenantId) return null;

  return (
    <div style={{ maxWidth: 560, display: "grid", gap: 14 }}>
      <Link href={pathWithMarketingScope("/marketing/events", querySuffix)}>← Back</Link>
      <h2 style={{ margin: 0 }}>New event</h2>
      {msg ? <p style={{ color: "#b42318" }}>{msg}</p> : null}
      <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={inp} />
      <textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={inp} />
      <select value={eventType} onChange={(e) => setEventType(e.target.value)} style={inp}>
        <option value="networking">Networking</option>
        <option value="workshop">Workshop</option>
        <option value="open_house">Open house</option>
        <option value="afterwork">Afterwork</option>
        <option value="webinar">Webinar</option>
        <option value="other">Other</option>
      </select>
      <label style={{ fontSize: 14 }}>Start</label>
      <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} style={inp} />
      <label style={{ fontSize: 14 }}>End</label>
      <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} style={inp} />
      <input placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} style={inp} />
      <input placeholder="Max attendees" value={maxAtt} onChange={(e) => setMaxAtt(e.target.value)} style={inp} />
      <input placeholder="Price (0 = free)" value={price} onChange={(e) => setPrice(e.target.value)} style={inp} />
      <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} style={inp}>
        <option value="">Property (optional)</option>
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select value={status} onChange={(e) => setStatus(e.target.value)} style={inp}>
        <option value="draft">Draft</option>
        <option value="published">Published</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
        Public on /events/[slug]
      </label>
      <button type="button" onClick={() => void submit()} disabled={busy} style={{ padding: 12, borderRadius: 8, background: "var(--petrol)", color: "#fff", border: "none", cursor: "pointer" }}>
        Save
      </button>
    </div>
  );
}

const inp: React.CSSProperties = { padding: 10, borderRadius: 8, border: "1px solid rgba(26,74,74,0.25)" };
