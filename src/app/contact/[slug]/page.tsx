"use client";

import { useState } from "react";

export default function PropertyContactPage({ params }: { params: { slug: string } }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    interestedSpaceType: "office",
    message: "",
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    const resp = await fetch("/api/leads/public-contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, pipelineSlug: params.slug }),
    });
    const data = (await resp.json()) as { error?: string };
    setLoading(false);
    if (!resp.ok) {
      setResult(data.error ?? "Failed to send");
      return;
    }
    setResult("Thanks! Your inquiry was sent to this property's sales pipeline.");
    setForm({ name: "", email: "", phone: "", company: "", interestedSpaceType: "office", message: "" });
  }

  return (
    <section style={{ maxWidth: 700, margin: "0 auto", display: "grid", gap: 12 }}>
      <h1 style={{ marginBottom: 0 }}>Property contact</h1>
      <p style={{ marginTop: 0, color: "#475569" }}>
        You are contacting pipeline <code>{params.slug}</code>.
      </p>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <input required placeholder="Name" value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} style={{ padding: 10 }} />
        <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))} style={{ padding: 10 }} />
        <input placeholder="Phone" value={form.phone} onChange={(e) => setForm((v) => ({ ...v, phone: e.target.value }))} style={{ padding: 10 }} />
        <input placeholder="Company" value={form.company} onChange={(e) => setForm((v) => ({ ...v, company: e.target.value }))} style={{ padding: 10 }} />
        <select value={form.interestedSpaceType} onChange={(e) => setForm((v) => ({ ...v, interestedSpaceType: e.target.value }))} style={{ padding: 10 }}>
          <option value="office">Office</option>
          <option value="meeting_room">Meeting room</option>
          <option value="venue">Venue</option>
          <option value="hot_desk">Hot desk</option>
        </select>
        <textarea required rows={5} placeholder="Message" value={form.message} onChange={(e) => setForm((v) => ({ ...v, message: e.target.value }))} style={{ padding: 10 }} />
        <button type="submit" disabled={loading} style={{ padding: "10px 14px", width: 180 }}>
          {loading ? "Sending..." : "Send inquiry"}
        </button>
      </form>
      {result ? <p style={{ margin: 0 }}>{result}</p> : null}
    </section>
  );
}

