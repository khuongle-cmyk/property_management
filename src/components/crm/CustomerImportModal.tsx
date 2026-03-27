"use client";

import { useState } from "react";
import type { ParsedImportRow } from "@/lib/crm/lead-import-parse";
import { parseLeadImportFile } from "@/lib/crm/lead-import-file";

type DuplicateMode = "skip" | "update" | "error";

type ResultRow = { rowNumber: number; success: boolean; action?: string; error?: string };

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  zIndex: 200,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const box: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 20,
  maxWidth: 840,
  width: "100%",
  maxHeight: "92vh",
  overflow: "auto",
};

type Props = {
  open: boolean;
  tenantId: string | null;
  onClose: () => void;
  onImported: () => Promise<void>;
};

export function CustomerImportModal({ open, tenantId, onClose, onImported }: Props) {
  const [parsed, setParsed] = useState<ParsedImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>("error");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setParsed([]);
    setFileName("");
    setResults([]);
    setError(null);
  }

  if (!open) return null;

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    setResults([]);
    try {
      const rows = await parseLeadImportFile(file);
      setParsed(rows.filter((r) => r.company_name.trim() || r.email.trim()));
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read file");
      setParsed([]);
    }
  }

  async function runImport() {
    if (!tenantId?.trim() || !parsed.length) return;
    setLoading(true);
    setError(null);
    setResults([]);
    const rows = parsed.map((r) => ({
      company_name: r.company_name,
      contact_person_name: r.contact_person_name,
      contact_first_name: r.contact_first_name,
      contact_last_name: r.contact_last_name,
      contact_title: r.contact_title,
      contact_direct_phone: r.contact_direct_phone,
      email: r.email,
      phone: r.phone,
      source: r.source,
      business_id: r.business_id,
      company_registration: r.business_id,
      vat_number: r.vat_number,
      company_type: r.company_type,
      industry_sector: r.industry_sector,
      industry: r.industry_sector,
      company_size: r.company_size,
      company_website: r.company_website,
      website: r.company_website,
      billing_street: r.billing_street,
      billing_address: r.billing_street,
      billing_postal_code: r.billing_postal_code,
      billing_city: r.billing_city,
      billing_email: r.billing_email,
      e_invoice_address: r.e_invoice_address,
      e_invoice_operator_code: r.e_invoice_operator_code,
      e_invoice_operator: r.e_invoice_operator_code,
      contact_phone_direct: r.contact_direct_phone,
      interested_property: r.interested_property_raw.trim() || null,
      interested_space_type: r.space_type,
      approx_size_m2: r.approx_size_m2,
      approx_budget_eur_month: r.approx_budget_eur_month,
      preferred_move_in_date: r.preferred_move_in_date,
      notes: r.notes,
    }));
    const res = await fetch("/api/crm/leads/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: tenantId.trim(), duplicateMode, rows }),
    });
    const data = (await res.json()) as { error?: string; results?: ResultRow[] };
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Import failed");
      return;
    }
    setResults(data.results ?? []);
    await onImported();
  }

  return (
    <div style={overlay} role="presentation" onClick={onClose}>
      <div role="dialog" aria-modal style={box} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Import customers</h2>
        <p style={{ fontSize: 14, color: "#64748b" }}>
          Download the CSV template for column names, then upload a <strong>.csv</strong> or <strong>.xlsx</strong> file. Preview rows below and choose
          how to handle duplicate emails (same tenant).
        </p>
        {!tenantId ? (
          <p style={{ color: "#b91c1c" }}>No organization context — cannot import.</p>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <a
            href="/api/crm/leads/import-template"
            download
            style={{
              display: "inline-block",
              padding: "10px 14px",
              background: "#1d4ed8",
              color: "#fff",
              borderRadius: 8,
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Download CSV template
          </a>
          <input
            type="file"
            accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
        </div>
        {fileName ? (
          <p style={{ margin: "0 0 8px", fontSize: 14 }}>
            File: <strong>{fileName}</strong> — {parsed.length} data row(s)
          </p>
        ) : null}
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}

        <fieldset style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <legend style={{ fontWeight: 600 }}>If email already exists for this organization</legend>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <input type="radio" name="dup" checked={duplicateMode === "error"} onChange={() => setDuplicateMode("error")} />
            Mark row as error (skip that row, report duplicate)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <input type="radio" name="dup" checked={duplicateMode === "skip"} onChange={() => setDuplicateMode("skip")} />
            Skip — keep existing lead, count row as skipped
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="radio" name="dup" checked={duplicateMode === "update"} onChange={() => setDuplicateMode("update")} />
            Update — overwrite fields on the existing lead (stage unchanged)
          </label>
        </fieldset>

        {parsed.length > 0 ? (
          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["#", "Company", "Contact", "Email", "Phone", "Property", "Space", "Budget"].map((h) => (
                    <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 6 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 25).map((r) => (
                  <tr key={r.rowNumber}>
                    <td style={{ borderBottom: "1px solid #f1f5f9", padding: 6 }}>{r.rowNumber}</td>
                    <td style={{ borderBottom: "1px solid #f1f5f9", padding: 6 }}>{r.company_name}</td>
                    <td style={{ borderBottom: "1px solid #f1f5f9", padding: 6 }}>{r.contact_person_name}</td>
                    <td style={{ borderBottom: "1px solid #f1f5f9", padding: 6 }}>{r.email}</td>
                    <td style={{ borderBottom: "1px solid #f1f5f9", padding: 6 }}>{r.phone ?? "—"}</td>
                    <td style={{ borderBottom: "1px solid #f1f5f9", padding: 6 }}>{r.interested_property_raw || "—"}</td>
                    <td style={{ borderBottom: "1px solid #f1f5f9", padding: 6 }}>{r.space_type ?? "—"}</td>
                    <td style={{ borderBottom: "1px solid #f1f5f9", padding: 6 }}>
                      {r.approx_budget_eur_month != null ? r.approx_budget_eur_month : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.length > 25 ? <p style={{ fontSize: 13, color: "#64748b" }}>Showing first 25 of {parsed.length} rows.</p> : null}
          </div>
        ) : null}

        {results.length > 0 ? (
          <div style={{ marginBottom: 12, maxHeight: 200, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
            <strong>Results</strong>
            {results.map((r) => (
              <div
                key={r.rowNumber}
                style={{ fontSize: 13, color: r.success ? "#166534" : "#b91c1c", marginTop: 4 }}
              >
                Row {r.rowNumber}:{" "}
                {r.success
                  ? r.action === "skipped"
                    ? "Skipped (duplicate)"
                    : r.action === "updated"
                      ? "Updated"
                      : "Imported"
                  : r.error ?? "Error"}
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            style={{ padding: "8px 14px" }}
          >
            Close
          </button>
          <button
            type="button"
            disabled={loading || !tenantId || !parsed.length}
            onClick={() => void runImport()}
            style={{ padding: "8px 14px", fontWeight: 600 }}
          >
            {loading ? "Importing…" : "Confirm import"}
          </button>
        </div>
      </div>
    </div>
  );
}
