"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import {
  ADMIN_FEE_TYPE_LABELS,
  ADMIN_FEE_TYPES,
  FEE_CALC_MODE_LABELS,
  FEE_CALC_MODES,
  FIXED_PERIODS,
  PERCENTAGE_BASIS_LABELS,
  PERCENTAGE_BASES,
  type FeeCalcMode,
  displayNameForSetting,
  isLegacyFeeCategory,
  listColumnCalculationLabel,
} from "@/lib/reports/admin-fee-constants";
import {
  basisAmountFromAdminFeeBasis,
  computeClampedAdminFeeForBasis,
  computeRawAdminFee,
  formatAdminFeeAmountOrPercent,
  getEffectiveCalculationMode,
  type AdminFeeBasis,
  type AdministrationCostSettingRow,
} from "@/lib/reports/administration-cost-fees-report";

type TenantOpt = { id: string; name: string | null };
type PropertyOpt = { id: string; name: string | null; label: string; tenantName?: string | null };

type Props = {
  /** Report scope end date (YYYY-MM-DD from date input); preview uses this month as `month_key`. */
  endDate: string;
};

type FormDraft = {
  calculationMode: FeeCalcMode;
  feeCategory: string;
  feeNameOther: string;
  property_id: string | null;
  fixed_amount: number | null;
  fixed_period: string;
  percentage_value: number | null;
  percentage_basis: string;
  minimum_fee: number | null;
  maximum_fee: number | null;
  is_active: boolean;
};

const inputStyle: CSSProperties = { padding: 8, borderRadius: 8, border: "1px solid #ccc", width: "100%" };
const btn: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
};
const btnGhost: CSSProperties = { ...btn, background: "#fff", color: "#111" };

function formatMonthLabel(monthKey: string | null): string {
  if (!monthKey) return "last month";
  const parts = monthKey.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return monthKey;
  return new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "short", year: "numeric" });
}

function feeCategoryFromRow(s: AdministrationCostSettingRow): string {
  const ft = (s.fee_type ?? "").trim();
  if (isLegacyFeeCategory(ft)) return ft || "management_fee";
  const legacyCalc = new Set(["fixed_amount", "percentage_of_revenue", "percentage_of_costs", "fixed_plus_percentage"]);
  if (legacyCalc.has(ft)) {
    const c = (s.custom_name ?? "").trim();
    return c || "management_fee";
  }
  return ((s.custom_name ?? ft) || "management_fee").trim() || "management_fee";
}

function emptyDraft(): FormDraft {
  return {
    calculationMode: "fixed",
    feeCategory: "management_fee",
    feeNameOther: "",
    property_id: null,
    fixed_amount: null,
    fixed_period: "monthly",
    percentage_value: null,
    percentage_basis: "total_revenue",
    minimum_fee: null,
    maximum_fee: null,
    is_active: true,
  };
}

function resolvedFeeName(d: FormDraft): string {
  if (d.feeCategory === "other") return d.feeNameOther.trim();
  return (ADMIN_FEE_TYPE_LABELS[d.feeCategory] ?? d.feeNameOther.trim()) || "Fee";
}

function draftToPseudoSetting(d: FormDraft, tenantId: string): AdministrationCostSettingRow {
  return {
    id: "draft",
    tenant_id: tenantId,
    property_id: d.property_id,
    name: resolvedFeeName(d),
    fee_type: d.feeCategory,
    custom_name: d.feeCategory,
    calculation_mode: d.calculationMode,
    fixed_amount: d.fixed_amount,
    fixed_period: d.fixed_period,
    percentage_value: d.percentage_value,
    percentage_basis: d.percentage_basis,
    minimum_fee: d.minimum_fee,
    maximum_fee: d.maximum_fee,
    is_active: d.is_active,
  };
}

export function AdminFeeSettingsPanel({ endDate }: Props) {
  /** YYYY-MM for preview-basis (same calendar month as report end date). */
  const previewMonthKey = useMemo(() => {
    const d = endDate.trim();
    if (d.length >= 7 && /^\d{4}-\d{2}/.test(d)) return d.substring(0, 7);
    return "";
  }, [endDate]);

  const [tenants, setTenants] = useState<TenantOpt[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [properties, setProperties] = useState<PropertyOpt[]>([]);
  const [settings, setSettings] = useState<AdministrationCostSettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<FormDraft>(() => emptyDraft());

  /** Property scope for preview API — must match dropdown (non-empty = single property). */
  const selectedPropertyId = useMemo(() => (draft.property_id ?? "").trim(), [draft.property_id]);

  const [previewBasis, setPreviewBasis] = useState<{
    monthKey: string | null;
    basisAmounts: Record<string, number>;
    revenueTotal: number;
    officeRent: number;
    totalCosts: number;
    note?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/super-admin/brands-tenants");
        const json = (await res.json()) as { tenants?: TenantOpt[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to load tenants");
        if (cancelled) return;
        setTenants(json.tenants ?? []);
        if ((json.tenants?.length ?? 0) > 0) setTenantId(json.tenants![0].id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadProperties = useCallback(async (tid: string) => {
    if (!tid) {
      setProperties([]);
      return;
    }
    try {
      const res = await fetch(`/api/admin-fees/properties?tenant_id=${encodeURIComponent(tid)}`);
      const json = (await res.json()) as { properties?: PropertyOpt[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load properties");
      setProperties(json.properties ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load properties");
      setProperties([]);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    if (!tenantId) return;
    setListLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ tenant_id: tenantId });
      const res = await fetch(`/api/admin-fees?${q.toString()}`);
      const json = (await res.json()) as { settings?: AdministrationCostSettingRow[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load settings");
      setSettings(json.settings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setListLoading(false);
    }
  }, [tenantId]);

  const loadPreviewBasis = useCallback(async () => {
    if (!tenantId) return;
    try {
      const params = new URLSearchParams({ tenant_id: tenantId });
      if (previewMonthKey) params.set("month_key", previewMonthKey);
      if (selectedPropertyId !== "") params.set("property_id", selectedPropertyId);
      const res = await fetch(`/api/admin-fees/preview-basis?${params.toString()}`);
      const json = (await res.json()) as {
        monthKey?: string | null;
        basisAmounts?: Record<string, number>;
        revenueTotal?: number;
        officeRent?: number;
        totalCosts?: number;
        note?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Preview failed");
      const basisAmounts = json.basisAmounts ?? {
        total_revenue: json.revenueTotal ?? 0,
        total_costs: json.totalCosts ?? 0,
        office_rent_only: json.officeRent ?? 0,
        meeting_room_revenue: 0,
        hot_desk_revenue: 0,
        virtual_office_revenue: 0,
        furniture_revenue: 0,
        additional_services_revenue: 0,
        hr_costs: 0,
      };
      setPreviewBasis({
        monthKey: json.monthKey ?? null,
        basisAmounts,
        revenueTotal: json.revenueTotal ?? basisAmounts.total_revenue ?? 0,
        officeRent: json.officeRent ?? basisAmounts.office_rent_only ?? 0,
        totalCosts: json.totalCosts ?? basisAmounts.total_costs ?? 0,
        note: json.note,
      });
    } catch {
      setPreviewBasis({
        monthKey: null,
        basisAmounts: {
          total_revenue: 100000,
          total_costs: 35000,
          office_rent_only: 40000,
          meeting_room_revenue: 5000,
          hot_desk_revenue: 3000,
          virtual_office_revenue: 2000,
          furniture_revenue: 1500,
          additional_services_revenue: 800,
          hr_costs: 18500,
        },
        revenueTotal: 100000,
        officeRent: 40000,
        totalCosts: 35000,
        note: "Illustrative",
      });
    }
  }, [tenantId, selectedPropertyId, previewMonthKey]);

  useEffect(() => {
    void loadProperties(tenantId);
  }, [tenantId, loadProperties]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    void loadPreviewBasis();
  }, [loadPreviewBasis]);

  const previewBasisAgg: AdminFeeBasis | null = previewBasis
    ? {
        rev: previewBasis.basisAmounts.total_revenue ?? previewBasis.revenueTotal,
        office: previewBasis.basisAmounts.office_rent_only ?? previewBasis.officeRent,
        meeting: previewBasis.basisAmounts.meeting_room_revenue ?? 0,
        hotDesk: previewBasis.basisAmounts.hot_desk_revenue ?? 0,
        virtualOffice: previewBasis.basisAmounts.virtual_office_revenue ?? 0,
        furniture: previewBasis.basisAmounts.furniture_revenue ?? 0,
        additionalServices: previewBasis.basisAmounts.additional_services_revenue ?? 0,
        costs: previewBasis.basisAmounts.total_costs ?? previewBasis.totalCosts,
        hrStaffCosts: previewBasis.basisAmounts.hr_costs ?? 0,
      }
    : null;

  const pseudoSetting = useMemo(
    () => (tenantId ? draftToPseudoSetting(draft, tenantId) : null),
    [draft, tenantId],
  );

  const previewAmount = useMemo(() => {
    if (!previewBasisAgg || !pseudoSetting) return null;
    return computeClampedAdminFeeForBasis(pseudoSetting, previewBasisAgg);
  }, [previewBasisAgg, pseudoSetting]);

  const rawPreviewFee = useMemo(() => {
    if (!previewBasisAgg || !pseudoSetting) return null;
    return computeRawAdminFee(pseudoSetting, previewBasisAgg);
  }, [previewBasisAgg, pseudoSetting]);

  const basisAmountForPreview = useMemo(() => {
    if (!previewBasisAgg) return 0;
    return basisAmountFromAdminFeeBasis(previewBasisAgg, draft.percentage_basis);
  }, [draft.percentage_basis, previewBasisAgg]);

  const monthLabelForPreview = useMemo(() => formatMonthLabel(previewBasis?.monthKey ?? null), [previewBasis?.monthKey]);

  /** e.g. "Dec 2025 Total revenue" or "Dec 2025 HR costs" for the preview line in parentheses */
  const basisLabelPhraseForPreview = useMemo(() => {
    const b = draft.percentage_basis;
    if (b === "hr_costs") {
      return `${monthLabelForPreview} HR costs`;
    }
    const name = PERCENTAGE_BASIS_LABELS[b] ?? b ?? "basis";
    return `${monthLabelForPreview} ${name}`;
  }, [draft.percentage_basis, monthLabelForPreview]);

  const previewLines = useMemo(() => {
    if (!previewBasisAgg || previewAmount == null || rawPreviewFee == null || !pseudoSetting) return [];
    const m = draft.calculationMode;
    const pct = Number(draft.percentage_value);
    const fixedMo = (() => {
      const f = Number(draft.fixed_amount);
      if (!Number.isFinite(f) || f <= 0) return 0;
      return String(draft.fixed_period).toLowerCase() === "annual" ? f / 12 : f;
    })();
    const pctPart = Number.isFinite(pct) && pct > 0 ? (pct / 100) * basisAmountForPreview : 0;
    const hasClamp =
      (draft.minimum_fee != null && Number.isFinite(Number(draft.minimum_fee))) ||
      (draft.maximum_fee != null && Number.isFinite(Number(draft.maximum_fee)));

    if (m === "fixed") {
      return [`Fixed: ${moneyFmt(fixedMo)}`, `= Total: ${moneyFmt(previewAmount)}/month${hasClamp && rawPreviewFee !== previewAmount ? ` (after min/max)` : ""}`];
    }
    if (m === "percentage") {
      return [
        `${Number.isFinite(pct) ? pct : 0}% of ${moneyFmt(basisAmountForPreview)} (${basisLabelPhraseForPreview}) = ${moneyFmt(pctPart)}`,
        `= Total: ${moneyFmt(previewAmount)}/month${hasClamp && rawPreviewFee !== previewAmount ? ` (after min/max)` : ""}`,
      ];
    }
    if (m === "combination") {
      return [
        `Fixed: ${moneyFmt(fixedMo)}`,
        `+ ${Number.isFinite(pct) ? pct : 0}% of ${moneyFmt(basisAmountForPreview)} (${basisLabelPhraseForPreview}) = ${moneyFmt(pctPart)}`,
        `= Total: ${moneyFmt(previewAmount)}/month${hasClamp && rawPreviewFee !== previewAmount ? ` (after min/max)` : ""}`,
      ];
    }
    return [];
  }, [basisAmountForPreview, basisLabelPhraseForPreview, draft, previewAmount, previewBasisAgg, pseudoSetting, rawPreviewFee]);

  const resetDraft = () => {
    setEditingId(null);
    setDraft(emptyDraft());
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    const name = resolvedFeeName(draft);
    if (!name) {
      setError("Enter a fee name (choose a type or enter custom text for Other).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        tenant_id: tenantId,
        property_id: draft.property_id || null,
        fee_name: name,
        fee_category: draft.feeCategory,
        calculation_mode: draft.calculationMode,
        fixed_amount: draft.fixed_amount != null ? Number(draft.fixed_amount) : null,
        fixed_period: draft.fixed_period ?? "monthly",
        percentage_value: draft.percentage_value != null ? Number(draft.percentage_value) : null,
        percentage_basis: draft.percentage_basis ?? null,
        minimum_fee:
          draft.minimum_fee != null && Number.isFinite(Number(draft.minimum_fee)) ? Number(draft.minimum_fee) : null,
        maximum_fee:
          draft.maximum_fee != null && Number.isFinite(Number(draft.maximum_fee)) ? Number(draft.maximum_fee) : null,
        is_active: draft.is_active !== false,
      };

      if (editingId) {
        const res = await fetch(`/api/admin-fees/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Save failed");
      } else {
        const res = await fetch("/api/admin-fees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Create failed");
      }
      resetDraft();
      await loadSettings();
      await loadPreviewBasis();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (s: AdministrationCostSettingRow) => {
    setEditingId(s.id);
    const feeCat = feeCategoryFromRow(s);
    const otherText = feeCat === "other" ? (s.name ?? "").trim() : "";

    setDraft({
      calculationMode: getEffectiveCalculationMode(s),
      feeCategory: feeCat,
      feeNameOther: otherText,
      property_id: s.property_id,
      fixed_amount: s.fixed_amount,
      fixed_period: s.fixed_period ?? "monthly",
      percentage_value: s.percentage_value,
      percentage_basis: s.percentage_basis ?? "total_revenue",
      minimum_fee: s.minimum_fee,
      maximum_fee: s.maximum_fee,
      is_active: s.is_active !== false,
    });
  };

  const onDelete = async (id: string) => {
    if (!globalThis.confirm("Delete this fee setting?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin-fees/${id}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Delete failed");
      if (editingId === id) resetDraft();
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const showFixedBlock = draft.calculationMode === "fixed" || draft.calculationMode === "combination";
  const showPctBlock = draft.calculationMode === "percentage" || draft.calculationMode === "combination";
  const showBasis = showPctBlock;
  const showMinMax = true;

  if (loading) return <p style={{ color: "#666", fontSize: 14 }}>Loading administration fee settings…</p>;

  return (
    <section
      className="no-print"
      style={{
        marginTop: 24,
        padding: 16,
        border: "1px solid #e0e0e0",
        borderRadius: 12,
        background: "#fafafa",
        maxWidth: 860,
      }}
    >
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Platform administration fees (super admin)</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#555" }}>
        Set how fees are calculated. They reduce net income in the report after property operating costs. Portfolio scope
        splits combined fees across properties using the same basis as the percentage (or revenue share for fixed-only).
      </p>

      {error ? (
        <p style={{ color: "#b00020", fontSize: 13, marginBottom: 10 }}>{error}</p>
      ) : null}

      <label style={{ display: "grid", gap: 4, fontSize: 13, marginBottom: 12 }}>
        <span>Organization</span>
        <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={inputStyle}>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name ?? t.id}
            </option>
          ))}
        </select>
      </label>

      <div style={{ overflowX: "auto", marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Type</th>
              <th style={th}>Amount / %</th>
              <th style={th}>Scope</th>
              <th style={th}>Month</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {listLoading ? (
              <tr>
                <td colSpan={6} style={td}>
                  Loading…
                </td>
              </tr>
            ) : settings.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ ...td, color: "#666" }}>
                  No fee rules yet. Add one below.
                </td>
              </tr>
            ) : (
              settings.map((s) => (
                <tr key={s.id}>
                  <td style={td}>{displayNameForSetting(s)}</td>
                  <td style={td}>{listColumnCalculationLabel(s)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{formatAdminFeeAmountOrPercent(s)}</td>
                  <td style={td}>
                    {s.property_id ? properties.find((p) => p.id === s.property_id)?.label ?? properties.find((p) => p.id === s.property_id)?.name ?? "—" : "Portfolio"}
                  </td>
                  <td style={td}>All months</td>
                  <td style={td}>
                    <button type="button" onClick={() => onEdit(s)} style={{ ...btnGhost, padding: "4px 8px", fontSize: 12 }}>
                      Edit
                    </button>{" "}
                    <button
                      type="button"
                      onClick={() => void onDelete(s.id)}
                      style={{ ...btnGhost, padding: "4px 8px", fontSize: 12, borderColor: "#c00", color: "#c00" }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} style={{ display: "grid", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{editingId ? "Edit fee line" : "Add fee line"}</p>

        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span>Fee name</span>
          <select
            value={draft.feeCategory}
            onChange={(e) => setDraft((d) => ({ ...d, feeCategory: e.target.value }))}
            style={inputStyle}
          >
            {ADMIN_FEE_TYPES.map((ft) => (
              <option key={ft} value={ft}>
                {ADMIN_FEE_TYPE_LABELS[ft] ?? ft}
              </option>
            ))}
          </select>
        </label>
        {draft.feeCategory === "other" ? (
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span>Custom name</span>
            <input
              type="text"
              value={draft.feeNameOther}
              onChange={(e) => setDraft((d) => ({ ...d, feeNameOther: e.target.value }))}
              placeholder="e.g. Special service fee"
              style={inputStyle}
            />
          </label>
        ) : null}

        <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>Calculation mode</span>
          <div
            role="radiogroup"
            aria-label="Calculation mode"
            style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
          >
            {FEE_CALC_MODES.map((cm) => (
              <label
                key={cm}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: draft.calculationMode === cm ? "2px solid #111" : "1px solid #ccc",
                  background: draft.calculationMode === cm ? "#f0f0f0" : "#fff",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="fee_calc_mode"
                  checked={draft.calculationMode === cm}
                  onChange={() => setDraft((d) => ({ ...d, calculationMode: cm }))}
                />
                {FEE_CALC_MODE_LABELS[cm] ?? cm}
              </label>
            ))}
          </div>
        </div>

        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span>Property (empty = portfolio-wide)</span>
          <select
            value={draft.property_id ?? ""}
            onChange={(e) => {
              const v = e.target.value.trim();
              setDraft((d) => ({ ...d, property_id: v || null }));
            }}
            style={inputStyle}
          >
            <option value="">— All properties (portfolio) —</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label ?? `${p.name ?? p.id}`}
              </option>
            ))}
          </select>
        </label>

        {showFixedBlock ? (
          <fieldset style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, margin: 0 }}>
            <legend style={{ fontSize: 13 }}>Fixed amount (€)</legend>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span>{draft.calculationMode === "combination" ? "Fixed (€) per month" : "Amount (€)"}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={draft.fixed_amount ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      fixed_amount: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span>Period</span>
                <select
                  value={draft.fixed_period}
                  onChange={(e) => setDraft((d) => ({ ...d, fixed_period: e.target.value }))}
                  style={inputStyle}
                >
                  {FIXED_PERIODS.map((p) => (
                    <option key={p} value={p}>
                      {p === "monthly" ? "Monthly" : "Annual"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>
        ) : null}

        {showPctBlock ? (
          <fieldset style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, margin: 0 }}>
            <legend style={{ fontSize: 13 }}>Percentage (%)</legend>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span>Percent (%)</span>
              <input
                type="text"
                inputMode="decimal"
                value={draft.percentage_value ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    percentage_value: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                style={inputStyle}
              />
            </label>
            {showBasis ? (
              <label style={{ display: "grid", gap: 4, fontSize: 13, marginTop: 8 }}>
                <span>% of (basis)</span>
                <select
                  value={draft.percentage_basis}
                  onChange={(e) => setDraft((d) => ({ ...d, percentage_basis: e.target.value }))}
                  style={inputStyle}
                >
                  {PERCENTAGE_BASES.map((b) => (
                    <option key={b} value={b}>
                      {PERCENTAGE_BASIS_LABELS[b]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </fieldset>
        ) : null}

        {showMinMax ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span>Minimum fee (€, optional)</span>
              <input
                type="text"
                inputMode="decimal"
                value={draft.minimum_fee ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    minimum_fee: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span>Maximum fee (€, optional)</span>
              <input
                type="text"
                inputMode="decimal"
                value={draft.maximum_fee ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    maximum_fee: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
                style={inputStyle}
              />
            </label>
          </div>
        ) : null}

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={draft.is_active}
            onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))}
          />
          Active
        </label>

        {previewBasis && previewAmount != null && pseudoSetting ? (
          <div
            style={{
              padding: 12,
              background: "#fff",
              borderRadius: 8,
              border: "1px solid #e5e5e5",
              fontSize: 13,
            }}
          >
            <strong>Preview</strong> — net income report figures for{" "}
            <strong>{previewBasis.monthKey ?? "—"}</strong>
            {draft.property_id ? " (selected property)" : " (portfolio)"}
            {previewBasis.note ? ` — ${previewBasis.note}` : ""}
            <ul
              style={{
                margin: "8px 0 0",
                paddingLeft: 18,
                color: "#444",
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              {PERCENTAGE_BASES.map((key) => (
                <li key={key}>
                  {key === "total_costs" ? (
                    <>
                      Total costs: {moneyFmt(previewBasis.basisAmounts[key] ?? 0)} (
                      {formatMonthLabel(previewBasis.monthKey ?? null)})
                    </>
                  ) : (
                    <>
                      {PERCENTAGE_BASIS_LABELS[key]}: {moneyFmt(previewBasis.basisAmounts[key] ?? 0)}
                    </>
                  )}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 10, fontFamily: "system-ui", lineHeight: 1.5, whiteSpace: "pre-line" }}>
              {previewLines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="submit" disabled={saving} style={btn}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Save fee line"}
          </button>
          <button type="button" onClick={resetDraft} style={btnGhost}>
            {editingId ? "Cancel edit" : "Add another fee line"}
          </button>
          <button type="button" onClick={() => void loadSettings()} style={btnGhost} disabled={listLoading}>
            Refresh
          </button>
        </div>
      </form>
    </section>
  );
}

function moneyFmt(n: number): string {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(n);
}

const th: CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  borderBottom: "1px solid #ddd",
  background: "#eee",
  fontSize: 12,
};
const td: CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #f0f0f0", verticalAlign: "top" };
