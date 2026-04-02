"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";

export type CrmLeadSearchRow = {
  id: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  contact_person_name: string | null;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  contact_direct_phone?: string | null;
};

type BrandColors = {
  white: string;
  border: string;
  text: string;
  primary: string;
  background?: string;
  hover?: string;
};

type ContactSearchWithCreateProps = {
  onSelect: (lead: CrmLeadSearchRow) => void;
  selectedLead: CrmLeadSearchRow | null;
  onClearSelection: () => void;
  onRequestCreate: (searchQuery: string) => void;
  colors: BrandColors;
  createDisabled?: boolean;
  createDisabledHint?: string;
};

function sanitizeIlikeFragment(q: string): string {
  return q.replace(/%/g, "").replace(/,/g, " ").trim().slice(0, 80);
}

export default function ContactSearchWithCreate({
  onSelect,
  selectedLead,
  onClearSelection,
  onRequestCreate,
  colors: c,
  createDisabled,
  createDisabledHint,
}: ContactSearchWithCreateProps) {
  const supabase = getSupabaseClient();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<CrmLeadSearchRow[]>([]);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inputStyle = {
    padding: "9px 12px",
    borderRadius: 8,
    border: `1px solid ${c.border}`,
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
    background: c.white,
    color: c.text,
  };

  useEffect(() => {
    const raw = query.trim();
    if (raw.length < 2) {
      setOptions([]);
      return;
    }
    const safe = sanitizeIlikeFragment(raw);
    if (safe.length < 2) {
      setOptions([]);
      return;
    }
    const t = setTimeout(() => {
      void supabase
        .from("leads")
        .select(
          "id,company_name,email,phone,contact_person_name,contact_first_name,contact_last_name,contact_direct_phone",
        )
        .or(`company_name.ilike.%${safe}%,contact_person_name.ilike.%${safe}%,email.ilike.%${safe}%`)
        .order("created_at", { ascending: false })
        .limit(10)
        .then(({ data }) => setOptions((data as CrmLeadSearchRow[]) ?? []));
    }, 300);
    return () => clearTimeout(t);
  }, [query, supabase]);

  const cancelBlur = useCallback(() => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = null;
  }, []);

  const scheduleBlur = useCallback(() => {
    cancelBlur();
    blurTimer.current = setTimeout(() => setOpen(false), 200);
  }, [cancelBlur]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {selectedLead ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${c.border}`,
            background: c.hover ?? c.background ?? "#f8fafc",
          }}
        >
          <div style={{ flex: "1 1 200px", fontSize: 14, color: c.text }}>
            <strong>{selectedLead.company_name ?? "—"}</strong>
            {selectedLead.contact_person_name ? (
              <span style={{ opacity: 0.85 }}> · {selectedLead.contact_person_name}</span>
            ) : null}
            {selectedLead.email ? <span style={{ opacity: 0.75 }}> · {selectedLead.email}</span> : null}
          </div>
          <button
            type="button"
            onClick={() => {
              onClearSelection();
              setQuery("");
              setOptions([]);
            }}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${c.primary}`,
              background: c.white,
              color: c.primary,
              fontWeight: 600,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Change
          </button>
        </div>
      ) : null}

      {!selectedLead ? (
        <div style={{ position: "relative" }}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              cancelBlur();
              setOpen(true);
            }}
            onBlur={scheduleBlur}
            placeholder="Search by company, contact, or email…"
            style={inputStyle}
            autoComplete="off"
          />
          {open && (options.length > 0 || query.trim().length >= 2) ? (
            <ul
              style={{
                position: "absolute",
                zIndex: 20,
                left: 0,
                right: 0,
                margin: 0,
                marginTop: 4,
                padding: 0,
                listStyle: "none",
                background: c.white,
                border: `1px solid ${c.border}`,
                borderRadius: 8,
                maxHeight: 280,
                overflow: "auto",
                boxShadow: `0 8px 24px ${c.primary}14`,
              }}
            >
              {options.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onMouseDown={cancelBlur}
                    onClick={() => {
                      onSelect(row);
                      setQuery(row.company_name ?? "");
                      setOpen(false);
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: "none",
                      background: c.white,
                      cursor: "pointer",
                      fontSize: 13,
                      color: c.text,
                      borderBottom: `1px solid ${c.border}`,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{row.company_name ?? "—"}</div>
                    <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
                      {[row.contact_person_name, row.email].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  disabled={createDisabled}
                  onMouseDown={cancelBlur}
                  onClick={() => {
                    if (createDisabled) return;
                    onRequestCreate(query.trim());
                    setOpen(false);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "none",
                    background: createDisabled ? "#f1f5f9" : c.white,
                    cursor: createDisabled ? "not-allowed" : "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                    color: createDisabled ? "#94a3b8" : c.primary,
                  }}
                >
                  + Create new contact
                </button>
              </li>
            </ul>
          ) : null}
        </div>
      ) : null}

      {createDisabled && createDisabledHint ? (
        <p style={{ margin: 0, fontSize: 12, color: c.text, opacity: 0.65 }}>{createDisabledHint}</p>
      ) : null}
    </div>
  );
}
