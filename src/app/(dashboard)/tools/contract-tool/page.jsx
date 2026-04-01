"use client";

/**
 * Contract tool — offers & contracts
 * Route: /tools/contract-tool
 */

import { useState, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import OfferEditor from "@/components/OfferEditor";
import ContractEditor from "@/components/ContractEditor";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { VILLAGEWORKS_BRAND } from "@/lib/brand/villageworks";
import { useConfirm } from "@/hooks/useConfirm";

const c = VILLAGEWORKS_BRAND.colors;

const OFFER_STATUS_COLORS = {
  draft: { bg: c.hover, fg: c.text },
  sent: { bg: c.border, fg: c.primary },
  viewed: { bg: c.hover, fg: c.secondary },
  accepted: { bg: c.hover, fg: c.success },
  declined: { bg: c.hover, fg: c.danger },
  expired: { bg: c.border, fg: c.text },
};

const CONTRACT_STATUS_COLORS = {
  draft: { bg: c.hover, fg: c.text },
  sent: { bg: c.border, fg: c.primary },
  signed_digital: { bg: c.hover, fg: c.accent },
  signed_paper: { bg: c.hover, fg: c.warning },
  active: { bg: c.hover, fg: c.success },
};

export default function ContractToolPage() {
  const supabase = getSupabaseClient();
  const [ConfirmModal, confirm] = useConfirm();
  const [mainTab, setMainTab] = useState("offers");

  const [offerView, setOfferView] = useState("list");
  const [offerEditId, setOfferEditId] = useState(null);
  const [offers, setOffers] = useState([]);
  const [offerLoading, setOfferLoading] = useState(true);
  const [offerFilter, setOfferFilter] = useState("all");
  const [offerDeleteError, setOfferDeleteError] = useState(null);

  const [contractView, setContractView] = useState("list");
  const [contractEditId, setContractEditId] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [contractLoading, setContractLoading] = useState(true);
  const [contractFilter, setContractFilter] = useState("all");
  const [contractDeleteError, setContractDeleteError] = useState(null);

  const loadOffers = useCallback(async () => {
    setOfferLoading(true);
    let q = supabase
      .from("offers")
      .select("id,title,status,version,customer_name,customer_company,monthly_price,created_at,sent_at,is_template")
      .eq("is_template", false)
      .order("created_at", { ascending: false });
    if (offerFilter !== "all") q = q.eq("status", offerFilter);
    const { data } = await q;
    setOffers(data ?? []);
    setOfferLoading(false);
  }, [supabase, offerFilter]);

  const loadContracts = useCallback(async () => {
    setContractLoading(true);
    let q = supabase
      .from("contracts")
      .select("id,title,status,version,customer_company,monthly_price,created_at,is_template,offer_id,source_offer_id")
      .eq("is_template", false)
      .order("created_at", { ascending: false });
    if (contractFilter !== "all") q = q.eq("status", contractFilter);
    const { data } = await q;
    setContracts(data ?? []);
    setContractLoading(false);
  }, [supabase, contractFilter]);

  useEffect(() => {
    loadOffers();
  }, [loadOffers]);

  useEffect(() => {
    if (mainTab === "contracts") {
      loadContracts();
    }
  }, [mainTab, loadContracts]);

  function openNewOffer() {
    setOfferEditId(null);
    setOfferView("edit");
  }
  function openEditOffer(id) {
    setOfferEditId(id);
    setOfferView("edit");
  }
  function backToOfferList() {
    setOfferView("list");
    loadOffers();
  }

  async function deleteOfferRow(offer) {
    setOfferDeleteError(null);
    const { data: linked, error: linkedErr } = await supabase
      .from("contracts")
      .select("id")
      .or(`offer_id.eq.${offer.id},source_offer_id.eq.${offer.id}`)
      .limit(1);
    if (linkedErr) {
      setOfferDeleteError(linkedErr.message);
      return;
    }

    const hasLinked = Boolean(linked && linked.length > 0);
    const ok = hasLinked
      ? await confirm({
          title: "Delete this offer?",
          message:
            "This offer has a linked contract draft. Deleting the offer will also remove the contract draft. Continue?",
          confirmLabel: "Continue",
          confirmDanger: true,
        })
      : await confirm({
          title: "Delete this offer?",
          message: "This cannot be undone.",
          confirmLabel: "Delete",
          confirmDanger: true,
        });
    if (!ok) return;

    if (hasLinked) {
      const { error: unlinkErr } = await supabase
        .from("contracts")
        .update({ offer_id: null, source_offer_id: null })
        .or(`offer_id.eq.${offer.id},source_offer_id.eq.${offer.id}`);
      if (unlinkErr) {
        setOfferDeleteError(unlinkErr.message);
        return;
      }
    }

    const { error } = await supabase.from("offers").delete().eq("id", offer.id);
    if (error) {
      setOfferDeleteError(error.message);
      return;
    }
    await loadOffers();
  }

  function openNewContract() {
    setContractEditId(null);
    setContractView("edit");
  }
  function openEditContract(id) {
    setContractEditId(id);
    setContractView("edit");
  }
  function backToContractList() {
    setContractView("list");
    loadContracts();
  }

  async function deleteContractRow(contract) {
    setContractDeleteError(null);
    const ok = await confirm({
      title: "Delete this contract?",
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      confirmDanger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("contracts").delete().eq("id", contract.id);
    if (error) {
      const msg = String(error.message || "");
      if (msg.toLowerCase().includes("foreign key")) {
        setContractDeleteError("This contract cannot be deleted because it has linked records.");
      } else {
        setContractDeleteError(msg || "Failed to delete contract.");
      }
      return;
    }
    await loadContracts();
  }

  function mainTabs() {
    return (
      <div style={{ display: "flex", gap: 6, marginBottom: 8, borderBottom: `1px solid ${c.border}`, paddingBottom: 12 }}>
        {[
          { id: "offers", label: "Offers" },
          { id: "contracts", label: "Contracts" },
        ].map((t) => {
          const active = mainTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setMainTab(t.id)}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: active ? `2px solid ${c.primary}` : `1px solid ${c.border}`,
                background: active ? c.primary : c.white,
                color: active ? c.white : c.primary,
                fontWeight: 700,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    );
  }

  const ms24h = 24 * 60 * 60 * 1000;
  const showNewDraftFromOfferBanner = contracts.some((row) => {
    if (row.status !== "draft") return false;
    if (!row.offer_id && !row.source_offer_id) return false;
    const created = row.created_at ? new Date(row.created_at).getTime() : 0;
    return Date.now() - created < ms24h;
  });

  function pillButton(active, onClick, label) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          padding: "6px 14px",
          borderRadius: 99,
          border: `1px solid`,
          fontSize: 13,
          cursor: "pointer",
          fontWeight: active ? 700 : 400,
          borderColor: active ? c.primary : c.border,
          background: active ? c.primary : c.white,
          color: active ? c.white : c.text,
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <DashboardLayout>
      <ConfirmModal />
      {mainTabs()}

      {mainTab === "offers" && offerView === "list" && (
        <div style={{ display: "grid", gap: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontWeight: 700, letterSpacing: "-0.02em", color: c.text }}>Offers</h1>
              <p style={{ margin: "4px 0 0", color: c.text, opacity: 0.72, fontSize: 14 }}>Create, edit and send offers. Accepting an offer opens a contract draft.</p>
            </div>
            <button
              type="button"
              onClick={openNewOffer}
              style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: c.primary, color: c.white, fontWeight: 700, cursor: "pointer", fontSize: 14 }}
            >
              + New offer
            </button>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["all", "draft", "sent", "viewed", "accepted", "declined"].map((s) => (
              <span key={s}>{pillButton(offerFilter === s, () => setOfferFilter(s), s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1))}</span>
            ))}
          </div>

          {offerDeleteError ? (
            <p style={{ margin: 0, fontSize: 12, color: c.danger }}>
              {offerDeleteError}
            </p>
          ) : null}

          {offerLoading ? (
            <p style={{ color: c.text, opacity: 0.65, fontSize: 14 }}>Loading…</p>
          ) : offers.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0", color: c.text, opacity: 0.65 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
              <div style={{ fontWeight: 600, marginBottom: 4, color: c.text }}>No offers yet</div>
              <div style={{ fontSize: 13 }}>Create your first offer to get started.</div>
            </div>
          ) : (
            <div style={{ border: `1px solid ${c.border}`, borderRadius: 12, overflow: "hidden", background: c.white }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: c.background }}>
                    {["Title", "Company", "Ver.", "Monthly", "Status", "Created", ""].map((h) => (
                      <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontWeight: 600, fontSize: 12, color: c.text, opacity: 0.72, borderBottom: `1px solid ${c.border}` }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {offers.map((p, i) => {
                    const sc = OFFER_STATUS_COLORS[p.status] ?? OFFER_STATUS_COLORS.draft;
                    return (
                      <tr key={p.id} style={{ borderBottom: i < offers.length - 1 ? `1px solid ${c.border}` : "none" }}>
                        <td style={{ padding: "12px 14px", fontWeight: 600, color: c.text }}>{p.title}</td>
                        <td style={{ padding: "12px 14px", color: c.text, opacity: 0.9 }}>
                          <div>{p.customer_company ?? p.customer_name ?? "—"}</div>
                        </td>
                        <td style={{ padding: "12px 14px", color: c.text }}>v{p.version ?? 1}.0</td>
                        <td style={{ padding: "12px 14px", color: c.text, opacity: 0.9 }}>
                          {p.monthly_price ? `€${Number(p.monthly_price).toLocaleString("en-IE")}/mo` : "—"}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: sc.bg, color: sc.fg }}>
                            {p.status}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px", color: c.text, opacity: 0.65, fontSize: 13 }}>{new Date(p.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              type="button"
                              onClick={() => openEditOffer(p.id)}
                              style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${c.primary}`, background: c.white, color: c.primary, fontWeight: 600, cursor: "pointer", fontSize: 12 }}
                            >
                              Edit
                            </button>
                            {p.status !== "accepted" ? (
                              <button
                                type="button"
                                onClick={() => void deleteOfferRow(p)}
                                style={{
                                  padding: "6px 14px",
                                  borderRadius: 6,
                                  border: `1px solid ${c.danger}`,
                                  background: c.white,
                                  color: c.danger,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  fontSize: 12
                                }}
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {mainTab === "offers" && offerView === "edit" && (
        <div style={{ display: "grid", gap: 16 }}>
          <button
            type="button"
            onClick={backToOfferList}
            style={{ width: "fit-content", padding: "7px 14px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.white, color: c.text, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
          >
            ← Back to offers
          </button>
          <OfferEditor
            offerId={offerEditId}
            onSaved={({ newOfferId } = {}) => {
              if (newOfferId) {
                setOfferEditId(newOfferId);
              }
            }}
            onDeleted={() => {
              setOfferView("list");
              loadOffers();
            }}
            onOfferAccepted={() => {
              setMainTab("contracts");
              loadContracts();
            }}
          />
        </div>
      )}

      {mainTab === "contracts" && contractView === "list" && (
        <div style={{ display: "grid", gap: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontWeight: 700, letterSpacing: "-0.02em", color: c.text }}>Contracts</h1>
              <p style={{ margin: "4px 0 0", color: c.text, opacity: 0.72, fontSize: 14 }}>Legal contracts and signing workflow.</p>
            </div>
            <button
              type="button"
              onClick={openNewContract}
              style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: c.primary, color: c.white, fontWeight: 700, cursor: "pointer", fontSize: 14 }}
            >
              + New contract
            </button>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["all", "draft", "sent", "signed_digital", "signed_paper", "active"].map((s) => (
              <span key={s}>
                {pillButton(
                  contractFilter === s,
                  () => setContractFilter(s),
                  s === "all" ? "All" : s.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
                )}
              </span>
            ))}
          </div>

          {showNewDraftFromOfferBanner ? (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                background: "#dcfce7",
                border: `1px solid ${c.success}`,
                color: "#166534",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              New contract draft created from accepted offer — review and send for signing
            </div>
          ) : null}

          {contractDeleteError ? (
            <p style={{ margin: 0, fontSize: 12, color: c.danger }}>
              {contractDeleteError}
            </p>
          ) : null}

          {contractLoading ? (
            <p style={{ color: c.text, opacity: 0.65, fontSize: 14 }}>Loading…</p>
          ) : contracts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0", color: c.text, opacity: 0.65 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📝</div>
              <div style={{ fontWeight: 600, marginBottom: 4, color: c.text }}>No contracts yet</div>
              <div style={{ fontSize: 13 }}>Accept an offer or create a contract manually.</div>
            </div>
          ) : (
            <div style={{ border: `1px solid ${c.border}`, borderRadius: 12, overflow: "hidden", background: c.white }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: c.background }}>
                    {["Company", "Status", "Version", "Monthly", "Created", ""].map((h) => (
                      <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontWeight: 600, fontSize: 12, color: c.text, opacity: 0.72, borderBottom: `1px solid ${c.border}` }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((row, i) => {
                    const sc = CONTRACT_STATUS_COLORS[row.status] ?? CONTRACT_STATUS_COLORS.draft;
                    return (
                      <tr key={row.id} style={{ borderBottom: i < contracts.length - 1 ? `1px solid ${c.border}` : "none" }}>
                        <td style={{ padding: "12px 14px", fontWeight: 600, color: c.text }}>{row.customer_company ?? "—"}</td>
                        <td style={{ padding: "12px 14px" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: sc.bg, color: sc.fg }}>
                            {row.status}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px", color: c.text }}>v{row.version ?? 1}.0</td>
                        <td style={{ padding: "12px 14px", color: c.text, opacity: 0.9 }}>
                          {row.monthly_price ? `€${Number(row.monthly_price).toLocaleString("en-IE")}/mo` : "—"}
                        </td>
                        <td style={{ padding: "12px 14px", color: c.text, opacity: 0.65, fontSize: 13 }}>{new Date(row.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              type="button"
                              onClick={() => openEditContract(row.id)}
                              style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${c.primary}`, background: c.white, color: c.primary, fontWeight: 600, cursor: "pointer", fontSize: 12 }}
                            >
                              Edit
                            </button>
                            {!["signed_digital", "signed_paper", "active"].includes(row.status) ? (
                              <button
                                type="button"
                                onClick={() => void deleteContractRow(row)}
                                style={{
                                  padding: "6px 14px",
                                  borderRadius: 6,
                                  border: `1px solid ${c.danger}`,
                                  background: c.white,
                                  color: c.danger,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  fontSize: 12,
                                }}
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {mainTab === "contracts" && contractView === "edit" && (
        <div style={{ display: "grid", gap: 16 }}>
          <button
            type="button"
            onClick={backToContractList}
            style={{ width: "fit-content", padding: "7px 14px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.white, color: c.text, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
          >
            ← Back to contracts
          </button>
          <ContractEditor
            contractId={contractEditId}
            onSaved={({ newContractId } = {}) => {
              if (newContractId) {
                setContractEditId(newContractId);
              }
            }}
            onDeleted={() => {
              setContractView("list");
              loadContracts();
            }}
          />
        </div>
      )}
    </DashboardLayout>
  );
}
