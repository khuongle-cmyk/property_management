"use client";

/**
 * PipelineOfferPanel
 *
 * Drop this inside your existing pipeline lead/deal card.
 * It shows a compact summary if an offer exists, or a button to create one.
 *
 * Props:
 *   leadId     — your pipeline lead UUID
 *   leadData   — { customerName, customerEmail, customerCompany, propertyId, monthlyPrice }
 *                (pre-fills the editor from pipeline data)
 */

import { useState, useEffect } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import OfferEditor from "@/components/OfferEditor";
import { VILLAGEWORKS_BRAND } from "@/lib/brand/villageworks";

const c = VILLAGEWORKS_BRAND.colors;

const STATUS_COLORS = {
  draft:    { bg: "#f1f0e8", fg: "#4b5563" },
  sent:     { bg: "#dbeafe", fg: "#1e40af" },
  viewed:   { bg: "#fef3c7", fg: "#92400e" },
  accepted: { bg: "#d1fae5", fg: "#065f46" },
  declined: { bg: "#fee2e2", fg: "#991b1b" },
};

export default function PipelineOfferPanel({ leadId, leadData = {} }) {
  const supabase = getSupabaseClient();
  const [offer, setOffer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  async function load() {
    if (!leadId) return;
    setLoading(true);
    const { data } = await supabase
      .from("offers")
      .select("id,title,status,customer_name,monthly_price,sent_at,updated_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setOffer(data ?? null);
    setLoading(false);
  }

  useEffect(() => { load(); }, [leadId]);

  const sc = STATUS_COLORS[offer?.status] ?? STATUS_COLORS.draft;

  // Map pipeline lead data → offer initial data
  const initialData = {
    customerName: leadData.customerName ?? "",
    customerEmail: leadData.customerEmail ?? "",
    customerCompany: leadData.customerCompany ?? "",
    propertyId: leadData.propertyId ?? "",
    monthlyPrice: leadData.monthlyPrice ?? "",
  };

  return (
    <div style={{ border: "1px solid #e5e3da", borderRadius: 10, overflow: "hidden" }}>
      {/* Summary bar */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 16px", background: "#f9f8f5", cursor: "pointer", userSelect: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1a2e2e" }}>Offer</span>
          {loading ? (
            <span style={{ fontSize: 12, color: "#6a8080" }}>Loading…</span>
          ) : offer ? (
            <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: sc.bg, color: sc.fg }}>
              {offer.status}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: "#6a8080" }}>No offer yet</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {offer && (
            <span style={{ fontSize: 12, color: "#6a8080" }}>
              {offer.monthly_price ? `€${Number(offer.monthly_price).toLocaleString("en-IE")}/mo` : ""}
            </span>
          )}
          <span style={{ fontSize: 12, color: c.primary, fontWeight: 600 }}>
            {expanded ? "▲ Close" : offer ? "▼ Edit" : "▼ Create"}
          </span>
        </div>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div style={{ padding: 20, borderTop: "1px solid #e5e3da" }}>
          <OfferEditor
            leadId={leadId}
            offerId={offer?.id ?? null}
            initialData={initialData}
            onSaved={() => { load(); }}
          />
        </div>
      )}
    </div>
  );
}
