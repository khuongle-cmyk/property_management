"use client";

import { useEffect, useState } from "react";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";

type Offer = {
  id: string;
  name: string;
  offer_type: string;
  promo_code: string | null;
  status: string;
  current_uses: number;
  max_uses: number | null;
  valid_from: string | null;
  valid_until: string | null;
};

export default function MarketingOffersPage() {
  const { tenantId, querySuffix, dataReady, allOrganizations } = useMarketingTenant();
  const [rows, setRows] = useState<Offer[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [offerType, setOfferType] = useState("discount_pct");
  const [pct, setPct] = useState("10");
  const [promo, setPromo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dataReady) return;
    let c = false;
    void (async () => {
      const res = await fetch(`/api/marketing/offers${querySuffix}`, { cache: "no-store" });
      const j = (await res.json()) as { offers?: Offer[]; error?: string };
      if (!c) {
        if (!res.ok) setErr(j.error ?? "Failed");
        else setRows(j.offers ?? []);
      }
    })();
    return () => {
      c = true;
    };
  }, [dataReady, querySuffix]);

  async function createOffer() {
    if (allOrganizations || !tenantId || !name.trim()) return;
    setBusy(true);
    const res = await fetch("/api/marketing/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        name: name.trim(),
        offer_type: offerType,
        discount_percentage: offerType === "discount_pct" ? Number(pct) : null,
        promo_code: promo.trim() || undefined,
        status: "draft",
      }),
    });
    const j = (await res.json()) as { offer?: Offer; error?: string };
    setBusy(false);
    if (!res.ok) setErr(j.error ?? "Failed");
    else {
      setName("");
      setPromo("");
      if (j.offer) setRows((r) => [j.offer!, ...r]);
    }
  }

  if (!dataReady) return null;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Offers & discounts</h2>
      <p style={{ margin: 0, fontSize: 14, opacity: 0.85 }}>
        Apply promo codes during booking/contract flows in a follow-up; usage is tracked on the offer row.
      </p>
      {err ? <p style={{ color: "#b42318" }}>{err}</p> : null}
      {allOrganizations ? (
        <p style={{ margin: 0, fontSize: 14, color: "rgba(26,74,74,0.8)" }}>
          Select a single organization above to create offers.
        </p>
      ) : null}
      <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)", display: "grid", gap: 10 }}>
        <input placeholder="Offer name" value={name} onChange={(e) => setName(e.target.value)} style={inp} />
        <select value={offerType} onChange={(e) => setOfferType(e.target.value)} style={inp}>
          <option value="discount_pct">% discount</option>
          <option value="discount_fixed">Fixed discount</option>
          <option value="free_period">Free months</option>
          <option value="bundle">Bundle</option>
          <option value="referral_bonus">Referral bonus</option>
        </select>
        {offerType === "discount_pct" ? <input placeholder="%" value={pct} onChange={(e) => setPct(e.target.value)} style={inp} /> : null}
        <input placeholder="Promo code (auto if empty)" value={promo} onChange={(e) => setPromo(e.target.value)} style={inp} />
        <button
          type="button"
          onClick={() => void createOffer()}
          disabled={busy || allOrganizations}
          style={{ padding: 10, borderRadius: 8, background: "var(--petrol)", color: "#fff", border: "none", cursor: "pointer" }}
        >
          Create
        </button>
      </div>
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(26,74,74,0.12)" }}>
              <th style={{ padding: 12 }}>Name</th>
              <th style={{ padding: 12 }}>Code</th>
              <th style={{ padding: 12 }}>Type</th>
              <th style={{ padding: 12 }}>Uses</th>
              <th style={{ padding: 12 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid rgba(26,74,74,0.06)" }}>
                <td style={{ padding: 12 }}>{r.name}</td>
                <td style={{ padding: 12 }}>{r.promo_code ?? "—"}</td>
                <td style={{ padding: 12 }}>{r.offer_type}</td>
                <td style={{ padding: 12 }}>
                  {r.current_uses}
                  {r.max_uses != null ? ` / ${r.max_uses}` : ""}
                </td>
                <td style={{ padding: 12 }}>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p style={{ padding: 16 }}>No offers.</p> : null}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { padding: 10, borderRadius: 8, border: "1px solid rgba(26,74,74,0.25)" };
