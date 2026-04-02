"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

const petrol = "#0d3d3a";
const gold = "#c8a96e";
const white = "#ffffff";
const pageBg = "#faf9f6";
const textDark = "#1a2e2e";
const tableStripe = "#f4f1ec";

type OfferRow = {
  id: string;
  title: string | null;
  status: string;
  customer_name: string | null;
  customer_company: string | null;
  space_details: string | null;
  monthly_price: number | null;
  contract_length_months: number | null;
  start_date: string | null;
  intro_text: string | null;
  terms_text: string | null;
  accepted_at: string | null;
};

type PropertyRow = { name: string | null; address: string | null; city: string | null } | null;

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function PublicOfferAcceptPage() {
  const params = useParams();
  const token = typeof params?.token === "string" ? params.token : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<OfferRow | null>(null);
  const [property, setProperty] = useState<PropertyRow>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [acceptedSuccess, setAcceptedSuccess] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError("Invalid link");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/offers/${encodeURIComponent(token)}/accept`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof j.error === "string" ? j.error : "Could not load offer");
      setOffer(null);
      setLoading(false);
      return;
    }
    setOffer(j.offer ?? null);
    setProperty(j.property ?? null);
    setCompanyName(typeof j.companyName === "string" ? j.companyName : null);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAccept() {
    if (!token) return;
    setAccepting(true);
    setAcceptError(null);
    const res = await fetch(`/api/offers/${encodeURIComponent(token)}/accept`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setAccepting(false);
    if (!res.ok) {
      setAcceptError(typeof j.error === "string" ? j.error : "Could not accept offer");
      return;
    }
    setAcceptedSuccess(true);
    if (offer) setOffer({ ...offer, status: "accepted", accepted_at: new Date().toISOString() });

    const oid = offer?.id;
    if (oid) {
      const opts = { method: "POST" as const, headers: { "Content-Type": "application/json" } };
      void fetch("/api/offers/send-email", {
        ...opts,
        body: JSON.stringify({
          offerId: oid,
          emailType: "offer_accepted_customer",
          publicToken: token,
        }),
      });
      void fetch("/api/offers/send-email", {
        ...opts,
        body: JSON.stringify({
          offerId: oid,
          emailType: "offer_accepted_internal",
          publicToken: token,
        }),
      });
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: pageBg, padding: 24, fontFamily: '"DM Sans", system-ui, sans-serif', color: textDark }}>
        <p style={{ textAlign: "center", opacity: 0.75 }}>Loading…</p>
      </div>
    );
  }

  if (error || !offer) {
    return (
      <div style={{ minHeight: "100vh", background: pageBg, padding: 24, fontFamily: '"DM Sans", system-ui, sans-serif', color: textDark }}>
        <p style={{ textAlign: "center", color: "#b91c1c" }}>{error ?? "Offer not found."}</p>
      </div>
    );
  }

  const displayCompany = companyName ?? offer.customer_company ?? "";
  const locationStr = property
    ? [property.name, property.address, property.city].filter(Boolean).join(", ") || "—"
    : "—";
  const title = offer.title ?? "Offer";
  const intro = offer.intro_text ?? "";
  const terms = offer.terms_text ?? "";
  const space = offer.space_details ?? "—";
  const rent =
    offer.monthly_price != null ? `€${Number(offer.monthly_price).toLocaleString("en-IE")} / month` : "—";
  const months = offer.contract_length_months != null ? `${offer.contract_length_months} months` : "—";
  const start = offer.start_date ? offer.start_date : "—";

  const isAccepted = offer.status === "accepted" || Boolean(offer.accepted_at);

  if (acceptedSuccess) {
    return (
      <div style={{ minHeight: "100vh", background: pageBg, padding: 24, fontFamily: '"DM Sans", system-ui, sans-serif', color: textDark }}>
        <div style={{ maxWidth: 640, margin: "48px auto", padding: 32, background: white, borderRadius: 12, border: `1px solid ${tableStripe}` }}>
          <p style={{ margin: 0, fontSize: 18, lineHeight: 1.65, textAlign: "center" }}>Thank you — your offer has been accepted. We will be in touch shortly with your contract.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: pageBg, fontFamily: '"DM Sans", system-ui, sans-serif', color: textDark }}>
      <header style={{ background: petrol, padding: "20px 24px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: white }}>VillageWorks</div>
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px 64px" }}>
        {isAccepted ? (
          <div
            style={{
              background: "#dcfce7",
              color: "#166534",
              padding: "16px 20px",
              borderRadius: 10,
              fontWeight: 600,
              marginBottom: 24,
              border: "1px solid #86efac",
            }}
          >
            You have already accepted this offer
          </div>
        ) : null}

        {!isAccepted && offer.status === "declined" ? (
          <div style={{ background: "#fee2e2", color: "#991b1b", padding: "16px 20px", borderRadius: 10, fontWeight: 600, marginBottom: 24 }}>
            This offer is no longer available
          </div>
        ) : null}

        {!isAccepted && offer.status === "expired" ? (
          <div style={{ background: "#f3f4f6", color: "#4b5563", padding: "16px 20px", borderRadius: 10, fontWeight: 600, marginBottom: 24 }}>
            This offer has expired
          </div>
        ) : null}

        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 30, fontWeight: 700, color: gold, margin: "0 0 12px", lineHeight: 1.2 }}>{title}</h1>

        {displayCompany || offer.customer_name ? (
          <p style={{ margin: "0 0 24px", fontSize: 15, color: textDark, opacity: 0.85 }}>
            Prepared for: <strong>{offer.customer_name || "—"}</strong>
            {displayCompany ? <span> · {displayCompany}</span> : null}
          </p>
        ) : null}

        <div style={{ fontFamily: "Georgia, serif", fontSize: 15, lineHeight: 1.75, marginBottom: 28 }} dangerouslySetInnerHTML={{ __html: escapeHtml(intro).replace(/\n/g, "<br>") }} />

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 28 }}>
          <tbody>
            <tr style={{ background: tableStripe }}>
              <td style={{ padding: "12px 14px", fontWeight: 600, width: "38%" }}>Space</td>
              <td style={{ padding: "12px 14px" }}>{space}</td>
            </tr>
            <tr>
              <td style={{ padding: "12px 14px", fontWeight: 600 }}>Location</td>
              <td style={{ padding: "12px 14px" }}>{locationStr}</td>
            </tr>
            <tr style={{ background: tableStripe }}>
              <td style={{ padding: "12px 14px", fontWeight: 600 }}>Monthly rent</td>
              <td style={{ padding: "12px 14px", fontWeight: 700, fontSize: 17, color: petrol }}>{rent}</td>
            </tr>
            <tr>
              <td style={{ padding: "12px 14px", fontWeight: 600 }}>Contract length</td>
              <td style={{ padding: "12px 14px" }}>{months}</td>
            </tr>
            <tr style={{ background: tableStripe }}>
              <td style={{ padding: "12px 14px", fontWeight: 600 }}>Start date</td>
              <td style={{ padding: "12px 14px" }}>{start}</td>
            </tr>
          </tbody>
        </table>

        <h2 style={{ fontSize: 16, fontWeight: 700, color: petrol, borderBottom: `1px solid ${tableStripe}`, paddingBottom: 8, marginBottom: 12 }}>Terms</h2>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 14, lineHeight: 1.7, opacity: 0.9, marginBottom: 32 }} dangerouslySetInnerHTML={{ __html: escapeHtml(terms).replace(/\n/g, "<br>") }} />

        {acceptError ? (
          <p style={{ color: "#b91c1c", fontSize: 14, marginBottom: 16 }}>{acceptError}</p>
        ) : null}

        {!isAccepted && offer.status !== "declined" && offer.status !== "expired" && (offer.status === "draft" || offer.status === "sent") ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
            <button
              type="button"
              onClick={handleAccept}
              disabled={accepting}
              className="rounded-lg border-0 bg-[#1a5c50] px-8 py-3 text-base font-medium text-white shadow-sm transition-colors duration-200 hover:bg-[#164e44] disabled:cursor-wait disabled:opacity-70 disabled:hover:bg-[#1a5c50]"
            >
              {accepting ? "Processing…" : "Accept this offer"}
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
