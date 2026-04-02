"use client";

import { useCallback, useEffect, useState } from "react";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";

type Offer = {
  id: string;
  tenant_id: string | null;
  name: string;
  offer_type: string;
  promo_code: string | null;
  status: string;
  current_uses: number;
  max_uses: number | null;
  valid_from: string | null;
  valid_until: string | null;
};

function orgColumnLabel(tenantId: string | null | undefined, tenants: { id: string; name: string }[]): string {
  if (tenantId == null || tenantId === "") return "All";
  return tenants.find((t) => t.id === tenantId)?.name ?? tenantId;
}

export default function MarketingOffersPage() {
  const { tenantId, tenants, querySuffix, dataReady, allOrganizations } = useMarketingTenant();
  const [rows, setRows] = useState<Offer[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [offerType, setOfferType] = useState("discount_pct");
  const [pct, setPct] = useState("10");
  const [promo, setPromo] = useState("");
  const [busy, setBusy] = useState(false);

  const loadOffers = useCallback(async () => {
    if (!dataReady) return;
    try {
      const res = await fetch(`/api/marketing/offers${querySuffix}`, { cache: "no-store" });
      const j = (await res.json()) as { offers?: Offer[]; error?: string };
      if (!res.ok) {
        const msg = j.error ?? "Failed to load offers";
        console.error("Offers list error:", j);
        setErr(msg);
        return;
      }
      setErr(null);
      setRows(j.offers ?? []);
    } catch (e) {
      console.error("Offers list unexpected error:", e);
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      alert("Unexpected error loading offers: " + msg);
    }
  }, [dataReady, querySuffix]);

  useEffect(() => {
    void loadOffers();
  }, [loadOffers]);

  async function createOffer() {
    const trimmed = name.trim();
    if (!trimmed) {
      const msg = "Offer name is required.";
      setErr(msg);
      alert(msg);
      return;
    }
    if (!allOrganizations && !tenantId) {
      const msg = "Select an organization in the header (or All organizations).";
      setErr(msg);
      alert(msg);
      return;
    }

    const pctNum = Number(pct);
    const discountPct = offerType === "discount_pct" && !Number.isNaN(pctNum) ? pctNum : null;
    const discountFixed = offerType === "discount_fixed" && !Number.isNaN(pctNum) ? pctNum : null;

    /** DB column `applicable_to` is space/product scope (offices|…|all), not org. Org is tenant_id / null. */
    const applicable_to = "all";

    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = {
        name: trimmed,
        offer_type: offerType,
        discount_percentage: discountPct,
        discount_fixed_amount: discountFixed,
        promo_code: promo.trim() || undefined,
        status: "draft",
        applicable_to,
      };
      if (allOrganizations) payload.allOrganizations = true;
      else payload.tenantId = tenantId;

      const res = await fetch("/api/marketing/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await res.json()) as { offer?: Offer; error?: string };

      if (!res.ok) {
        const msg = j.error ?? "Failed to create offer";
        console.error("Create offer error:", j);
        alert("Error: " + msg);
        setErr(msg);
        return;
      }

      setName("");
      setPromo("");
      setPct("10");
      setOfferType("discount_pct");
      await loadOffers();
    } catch (e) {
      console.error("Unexpected error creating offer:", e);
      const msg = e instanceof Error ? e.message : String(e);
      alert("Unexpected error: " + msg);
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!dataReady) return null;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Offers & discounts</h2>
      <p style={{ margin: 0, fontSize: 14, opacity: 0.85 }}>
        Apply promo codes during booking/contract flows in a follow-up; usage is tracked on the offer row. Rows with organization{" "}
        <strong>All</strong> apply across every organization (stored with no tenant).
      </p>
      {err ? <p style={{ color: "#b42318" }}>{err}</p> : null}
      <div style={{ background: "#fff", padding: 16, borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)", display: "grid", gap: 10 }}>
        <input placeholder="Offer name (required)" value={name} onChange={(e) => setName(e.target.value)} style={inp} />
        <select value={offerType} onChange={(e) => setOfferType(e.target.value)} style={inp}>
          <option value="discount_pct">% discount</option>
          <option value="discount_fixed">Fixed discount</option>
          <option value="free_period">Free months</option>
          <option value="bundle">Bundle</option>
          <option value="referral_bonus">Referral bonus</option>
        </select>
        {offerType === "discount_pct" || offerType === "discount_fixed" ? (
          <input
            placeholder={offerType === "discount_pct" ? "%" : "Amount"}
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            style={inp}
          />
        ) : null}
        <input placeholder="Promo code (auto if empty)" value={promo} onChange={(e) => setPromo(e.target.value)} style={inp} />
        <button
          type="button"
          onClick={() => void createOffer()}
          disabled={busy}
          style={{ padding: 10, borderRadius: 8, background: "var(--petrol)", color: "#fff", border: "none", cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? "Creating…" : `Create${allOrganizations ? " (all organizations)" : ""}`}
        </button>
      </div>
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(26,74,74,0.1)", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(26,74,74,0.12)" }}>
              <th style={{ padding: 12 }}>Name</th>
              <th style={{ padding: 12 }}>Organization</th>
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
                <td style={{ padding: 12 }}>{orgColumnLabel(r.tenant_id, tenants)}</td>
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
