"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import BudgetMonthGrid from "@/components/budget/BudgetMonthGrid";
import {
  BUDGET_COST_EDITABLE,
  BUDGET_COST_LABELS,
  BUDGET_COST_TYPES,
  BUDGET_OCCUPANCY_LABELS,
  BUDGET_OCCUPANCY_SPACE_TYPES,
  BUDGET_REVENUE_CATEGORIES,
  BUDGET_REVENUE_LABELS,
  MONTH_SHORT,
} from "@/lib/budget/constants";
import {
  aggregateCostByMonth,
  aggregateRevenueByMonth,
  capexCashOutByMonth,
  emptyMonthRecord,
  headcountStaffCostByMonth,
  monthIndexToKey,
  quarterKeys,
  totalCostPerMonth,
  totalRevenuePerMonth,
  type MonthKey,
} from "@/lib/budget/aggregates";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { REPORT_READER_ROLES } from "@/lib/reports/report-access";
import { loadScopedPropertiesForUser, type ScopedPropertyRow } from "@/lib/properties/scoped";
import type { ConsolidatedAnnualPL } from "@/lib/budget/consolidated-pl";

type BudgetMeta = {
  id: string;
  tenant_id: string;
  property_id: string | null;
  /** property | administration | combined */
  budget_scope?: string;
  name: string;
  budget_year: number;
  budget_type: string;
  status: string;
  notes: string | null;
  opening_cash_balance: number | string | null;
  parent_budget_id: string | null;
  version_label: string | null;
};

type LineRow = Record<string, unknown>;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mk(m: number): MonthKey {
  return monthIndexToKey(m);
}

function linesToRevenueGrid(lines: LineRow[], year: number): Record<string, Record<MonthKey, number>> {
  const out: Record<string, Record<MonthKey, number>> = {};
  for (const c of BUDGET_REVENUE_CATEGORIES) out[c] = emptyMonthRecord(0);
  for (const row of lines) {
    if (num(row.year) !== year) continue;
    const cat = String(row.category ?? "").trim() || "other";
    if (!out[cat]) out[cat] = emptyMonthRecord(0);
    const m = num(row.month);
    if (m < 1 || m > 12) continue;
    out[cat][mk(m)] += num(row.budgeted_amount);
  }
  return out;
}

function linesToCostGrid(lines: LineRow[], year: number): Record<string, Record<MonthKey, number>> {
  const out: Record<string, Record<MonthKey, number>> = {};
  for (const c of BUDGET_COST_TYPES) out[c] = emptyMonthRecord(0);
  for (const row of lines) {
    if (num(row.year) !== year) continue;
    const ct = String(row.cost_type ?? "").trim() || "other";
    if (!out[ct]) out[ct] = emptyMonthRecord(0);
    const m = num(row.month);
    if (m < 1 || m > 12) continue;
    out[ct][mk(m)] += num(row.budgeted_amount);
  }
  return out;
}

function gridToRevenueLines(budgetId: string, year: number, grid: Record<string, Record<MonthKey, number>>): LineRow[] {
  const rows: LineRow[] = [];
  for (const cat of BUDGET_REVENUE_CATEGORIES) {
    for (let m = 1; m <= 12; m++) {
      rows.push({
        budget_id: budgetId,
        property_id: null,
        month: m,
        year,
        category: cat,
        budgeted_amount: grid[cat]?.[mk(m)] ?? 0,
      });
    }
  }
  return rows;
}

function gridToCostLines(budgetId: string, year: number, grid: Record<string, Record<MonthKey, number>>): LineRow[] {
  const rows: LineRow[] = [];
  for (const ct of BUDGET_COST_EDITABLE) {
    for (let m = 1; m <= 12; m++) {
      rows.push({
        budget_id: budgetId,
        property_id: null,
        month: m,
        year,
        cost_type: ct,
        budgeted_amount: grid[ct]?.[mk(m)] ?? 0,
      });
    }
  }
  return rows;
}

const TABS = [
  "overview",
  "revenue",
  "costs",
  "headcount",
  "capex",
  "occupancy",
  "cashflow",
  "variance",
] as const;
type TabId = (typeof TABS)[number];

type NewBudgetScope = "property" | "administration" | "combined";

export default function BudgetPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [budgets, setBudgets] = useState<BudgetMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [budget, setBudget] = useState<BudgetMeta | null>(null);
  const [revLines, setRevLines] = useState<LineRow[]>([]);
  const [costLines, setCostLines] = useState<LineRow[]>([]);
  const [hcLines, setHcLines] = useState<LineRow[]>([]);
  const [capexLines, setCapexLines] = useState<LineRow[]>([]);
  const [occLines, setOccLines] = useState<LineRow[]>([]);
  const [properties, setProperties] = useState<ScopedPropertyRow[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [excelImportBusy, setExcelImportBusy] = useState(false);
  const [excelImportResult, setExcelImportResult] = useState<
    | null
    | { ok: true; revenueRows: number; costRows: number; propertiesImported?: number; summary?: string }
    | { ok: false; error: string }
  >(null);
  const [propertyFilter, setPropertyFilter] = useState<string | null>(null);
  const [view, setView] = useState<"monthly" | "quarterly" | "annual">("monthly");
  const [tab, setTab] = useState<TabId>("overview");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [variance, setVariance] = useState<{
    months: Array<{
      month: number;
      budgetRevenue: number;
      actualRevenue: number;
      budgetCost: number;
      actualCosts: number;
    }>;
  } | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [drill, setDrill] = useState<string | null>(null);

  const [revGrid, setRevGrid] = useState(() => {
    const g: Record<string, Record<MonthKey, number>> = {};
    for (const c of BUDGET_REVENUE_CATEGORIES) g[c] = emptyMonthRecord(0);
    return g;
  });
  const [costGrid, setCostGrid] = useState(() => {
    const g: Record<string, Record<MonthKey, number>> = {};
    for (const c of BUDGET_COST_TYPES) g[c] = emptyMonthRecord(0);
    return g;
  });

  const [portfolioPropIds, setPortfolioPropIds] = useState<Set<string>>(new Set());
  const [portfolioIncludeAdmin, setPortfolioIncludeAdmin] = useState(true);
  const [consolidated, setConsolidated] = useState<{
    pl: ConsolidatedAnnualPL;
    monthly: Array<{ month: number; revenue: number; propertyCosts: number; adminCosts: number; capex: number }>;
    bundlesUsed: Array<{ id: string; name: string; budget_scope: string; property_id: string | null }>;
  } | null>(null);
  const [combinations, setCombinations] = useState<
    Array<{ id: string; name: string; property_ids: string[]; include_admin: boolean }>
  >([]);
  const [comboSaving, setComboSaving] = useState(false);

  const [newBudgetOpen, setNewBudgetOpen] = useState(false);
  const [newBudgetYear, setNewBudgetYear] = useState(() => new Date().getFullYear() + 1);
  const [newBudgetScope, setNewBudgetScope] = useState<NewBudgetScope>("property");
  const [newBudgetPropertyId, setNewBudgetPropertyId] = useState("");
  const [newBudgetName, setNewBudgetName] = useState("");
  const [newBudgetNameTouched, setNewBudgetNameTouched] = useState(false);
  const [newBudgetSaving, setNewBudgetSaving] = useState(false);
  const [newBudgetError, setNewBudgetError] = useState<string | null>(null);

  const year = budget?.budget_year ?? new Date().getFullYear();
  const budgetScope = (budget?.budget_scope ?? "property").toLowerCase();

  const staffByMonth = useMemo(
    () => headcountStaffCostByMonth(hcLines as Parameters<typeof headcountStaffCostByMonth>[0], year, propertyFilter),
    [hcLines, year, propertyFilter],
  );

  const mergedCostGrid = useMemo(() => {
    const base = { ...costGrid };
    base.staff = { ...staffByMonth };
    return base;
  }, [costGrid, staffByMonth]);

  const revenueRowKeys = useMemo(() => {
    const base = [...BUDGET_REVENUE_CATEGORIES];
    const extras = Object.keys(revGrid).filter(
      (k) => !base.includes(k as (typeof BUDGET_REVENUE_CATEGORIES)[number]),
    );
    extras.sort();
    return [...base, ...extras];
  }, [revGrid]);

  const costRowKeysForGrid = useMemo(() => {
    const base = [...BUDGET_COST_TYPES];
    const extras = Object.keys(mergedCostGrid).filter(
      (k) => !base.includes(k as (typeof BUDGET_COST_TYPES)[number]),
    );
    extras.sort();
    return [...base, ...extras];
  }, [mergedCostGrid]);

  const overviewByProperty = useMemo(() => {
    type Row = { key: string; label: string; rev: number[]; cost: number[] };
    const byKey = new Map<string, Row>();
    const y = year;
    const getRow = (pid: string | null) => {
      const key = pid ?? "__unassigned__";
      let row = byKey.get(key);
      if (!row) {
        const label = pid
          ? (properties.find((p) => p.id === pid)?.name ?? `Property ${pid.slice(0, 8)}…`)
          : "Unassigned / org-wide";
        row = { key, label, rev: Array(12).fill(0), cost: Array(12).fill(0) };
        byKey.set(key, row);
      }
      return row;
    };
    for (const row of revLines as Array<{
      property_id?: string | null;
      year?: unknown;
      month?: unknown;
      budgeted_amount?: unknown;
    }>) {
      if (num(row.year) !== y) continue;
      const m = num(row.month);
      if (m < 1 || m > 12) continue;
      getRow(row.property_id ?? null).rev[m - 1] += num(row.budgeted_amount);
    }
    for (const row of costLines as Array<{
      property_id?: string | null;
      year?: unknown;
      month?: unknown;
      budgeted_amount?: unknown;
    }>) {
      if (num(row.year) !== y) continue;
      const m = num(row.month);
      if (m < 1 || m > 12) continue;
      getRow(row.property_id ?? null).cost[m - 1] += num(row.budgeted_amount);
    }
    const rows = [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
    const monthRev = Array.from({ length: 12 }, () => 0);
    const monthCost = Array.from({ length: 12 }, () => 0);
    const monthNet = Array.from({ length: 12 }, () => 0);
    for (let i = 0; i < 12; i++) {
      for (const r of rows) {
        monthRev[i] += r.rev[i];
        monthCost[i] += r.cost[i];
      }
      // budget_cost_lines.budgeted_amount is negative for expenses; net = revenue + costs (algebraic sum).
      monthNet[i] = monthRev[i] + monthCost[i];
    }
    const annualRev = monthRev.reduce((a, b) => a + b, 0);
    const annualCost = monthCost.reduce((a, b) => a + b, 0);
    return { rows, monthRev, monthCost, monthNet, annualRev, annualCost, annualNet: annualRev + annualCost };
  }, [revLines, costLines, year, properties]);

  const revenueLabelsForGrid = useMemo(() => {
    const o: Record<string, string> = { ...(BUDGET_REVENUE_LABELS as unknown as Record<string, string>) };
    for (const k of revenueRowKeys) {
      if (!o[k]) o[k] = k.replace(/_/g, " ");
    }
    return o;
  }, [revenueRowKeys]);

  const costLabelsForGrid = useMemo(() => {
    const o: Record<string, string> = { ...(BUDGET_COST_LABELS as unknown as Record<string, string>) };
    for (const k of costRowKeysForGrid) {
      if (!o[k]) o[k] = k.replace(/_/g, " ");
    }
    return o;
  }, [costRowKeysForGrid]);

  const revTot = useMemo(() => totalRevenuePerMonth(aggregateRevenueByMonth(revLines as never[], year, propertyFilter)), [revLines, year, propertyFilter]);
  const costTot = useMemo(
    () => totalCostPerMonth(aggregateCostByMonth(costLines as never[], year, propertyFilter, staffByMonth)),
    [costLines, year, propertyFilter, staffByMonth],
  );

  const loadBudgets = useCallback(async (tid: string, selectBudgetId?: string | null) => {
    const r = await fetch(`/api/budget?tenantId=${encodeURIComponent(tid)}`);
    if (!r.ok) return;
    const j = (await r.json()) as { budgets: BudgetMeta[] };
    setBudgets(j.budgets ?? []);
    if (selectBudgetId) {
      setSelectedId(selectBudgetId);
    } else {
      setSelectedId((cur) => cur ?? (j.budgets?.[0]?.id ?? null));
    }
  }, []);

  const loadBundle = useCallback(async (id: string) => {
    const r = await fetch(`/api/budget/${id}`);
    const raw = await r.text();
    if (!r.ok) {
      let detail = raw;
      try {
        const errBody = JSON.parse(raw) as { error?: string };
        if (errBody?.error) detail = errBody.error;
      } catch {
        /* keep raw */
      }
      console.error("loadBundle failed", r.status, detail);
      setMsg(`Could not load budget (${r.status}): ${detail}`);
      return;
    }
    let j: {
      budget: BudgetMeta;
      revenueLines: LineRow[];
      costLines: LineRow[];
      headcountLines: LineRow[];
      capexLines: LineRow[];
      occupancyLines: LineRow[];
    };
    try {
      j = JSON.parse(raw) as typeof j;
    } catch {
      setMsg("Could not load budget: invalid response");
      return;
    }
    setBudget(j.budget);
    setRevLines(j.revenueLines ?? []);
    setCostLines(j.costLines ?? []);
    setHcLines(j.headcountLines ?? []);
    setCapexLines(j.capexLines ?? []);
    setOccLines(j.occupancyLines ?? []);
    setRevGrid(linesToRevenueGrid(j.revenueLines ?? [], j.budget.budget_year));
    setCostGrid(linesToCostGrid(j.costLines ?? [], j.budget.budget_year));
  }, []);

  useEffect(() => {
    let c = false;
    (async () => {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: mem } = await supabase.from("memberships").select("tenant_id, role");
      const roles = (mem ?? []).map((m: { role: string | null }) => (m.role ?? "").toLowerCase());
      if (!roles.some((r: string) => REPORT_READER_ROLES.has(r))) {
        if (!c) setForbidden(true);
        if (!c) setReady(true);
        return;
      }
      const tid = (mem ?? []).find((m: { tenant_id: string | null }) => m.tenant_id)?.tenant_id ?? null;
      if (!c) {
        setTenantId(tid);
        setCanManage(roles.some((r) => ["owner", "manager", "super_admin"].includes(r)));
      }
      const scoped = await loadScopedPropertiesForUser(supabase, user.id);
      if (!c) {
        setProperties(scoped.properties ?? []);
        setIsSuperAdmin(scoped.isSuperAdmin);
      }
      if (tid) await loadBudgets(tid);
      if (!c) setReady(true);
    })();
    return () => {
      c = true;
    };
  }, [router, loadBudgets]);

  /**
   * Super admins see every property for portfolio / import mapping; other roles stay scoped to the active tenant.
   */
  const propertiesForTenant = useMemo(() => {
    if (!tenantId) return [];
    if (isSuperAdmin) return properties;
    return properties.filter((p) => p.tenant_id === tenantId);
  }, [properties, tenantId, isSuperAdmin]);

  const suggestNewBudgetName = useCallback(
    (scope: NewBudgetScope, y: number, propertyId: string) => {
      if (scope === "administration") return `Administration · ${y} Annual Budget`;
      if (scope === "combined") return `Portfolio · ${y} Annual Budget`;
      const p = propertiesForTenant.find((x) => x.id === propertyId);
      const label = (p?.name ?? "").trim() || "Property";
      return `${label} · ${y} Annual Budget`;
    },
    [propertiesForTenant],
  );

  useEffect(() => {
    if (!newBudgetOpen || newBudgetNameTouched) return;
    setNewBudgetName(suggestNewBudgetName(newBudgetScope, newBudgetYear, newBudgetPropertyId));
  }, [
    newBudgetOpen,
    newBudgetNameTouched,
    newBudgetScope,
    newBudgetYear,
    newBudgetPropertyId,
    suggestNewBudgetName,
  ]);

  useEffect(() => {
    if (!newBudgetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !newBudgetSaving) {
        e.preventDefault();
        setNewBudgetOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newBudgetOpen, newBudgetSaving]);

  useEffect(() => {
    setPortfolioPropIds(new Set(propertiesForTenant.map((p) => p.id)));
  }, [tenantId, propertiesForTenant]);

  useEffect(() => {
    if (!tenantId) return;
    let c = false;
    (async () => {
      const r = await fetch(`/api/budget/combinations?tenantId=${encodeURIComponent(tenantId)}`);
      if (!r.ok || c) return;
      const j = (await r.json()) as {
        combinations: Array<{ id: string; name: string; property_ids: string[]; include_admin: boolean }>;
      };
      setCombinations(j.combinations ?? []);
    })();
    return () => {
      c = true;
    };
  }, [tenantId]);

  useEffect(() => {
    if (!selectedId) return;
    loadBundle(selectedId);
  }, [selectedId, loadBundle]);

  useEffect(() => {
    if (!selectedId || tab !== "variance") return;
    let c = false;
    (async () => {
      const q = propertyFilter ? `?propertyId=${encodeURIComponent(propertyFilter)}` : "";
      const r = await fetch(`/api/budget/${selectedId}/actuals${q}`);
      if (!r.ok || c) return;
      const j = (await r.json()) as {
        months: Array<{
          month: number;
          budgetRevenue: number;
          actualRevenue: number;
          budgetCost: number;
          actualCosts: number;
        }>;
      };
      setVariance({ months: j.months });
    })();
    return () => {
      c = true;
    };
  }, [selectedId, tab, propertyFilter]);

  async function updatePortfolioView() {
    if (!tenantId) return;
    const allowed = new Set(propertiesForTenant.map((p) => p.id));
    const portfolioIds = [...portfolioPropIds].filter((id) => allowed.has(id));
    const params = new URLSearchParams({ tenantId, year: String(year) });
    for (const pid of portfolioIds) params.append("propertyId", pid);
    if (!portfolioIncludeAdmin) params.set("includeAdmin", "false");
    const r = await fetch(`/api/budget/consolidated?${params.toString()}`);
    if (!r.ok) {
      setMsg(await r.text());
      return;
    }
    const j = (await r.json()) as {
      pl: ConsolidatedAnnualPL;
      monthly: Array<{ month: number; revenue: number; propertyCosts: number; adminCosts: number; capex: number }>;
      bundlesUsed: Array<{ id: string; name: string; budget_scope: string; property_id: string | null }>;
    };
    setConsolidated(j);
    setMsg("Portfolio view updated.");
  }

  async function saveCurrentCombination() {
    if (!tenantId) return;
    const name = prompt("Name this portfolio view (e.g. Full portfolio, Helsinki core)?");
    if (!name?.trim()) return;
    setComboSaving(true);
    const r = await fetch("/api/budget/combinations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        name: name.trim(),
        property_ids: [...portfolioPropIds],
        include_admin: portfolioIncludeAdmin,
      }),
    });
    setComboSaving(false);
    if (!r.ok) setMsg(await r.text());
    else {
      const j = (await r.json()) as { combination: (typeof combinations)[number] };
      setCombinations((prev) => [j.combination, ...prev]);
      setMsg("Saved combination.");
    }
  }

  function applyCombination(c: { property_ids: string[]; include_admin: boolean }) {
    const allowed = new Set(propertiesForTenant.map((p) => p.id));
    setPortfolioPropIds(new Set(c.property_ids.filter((id) => allowed.has(id))));
    setPortfolioIncludeAdmin(c.include_admin);
    setMsg("Applied — click Update portfolio view to recalculate.");
  }

  async function saveRevenue() {
    if (!selectedId || !budget) return;
    setSaving(true);
    setMsg(null);
    const r = await fetch(`/api/budget/${selectedId}/lines`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revenueLines: gridToRevenueLines(selectedId, budget.budget_year, revGrid) }),
    });
    setSaving(false);
    if (!r.ok) setMsg(await r.text());
    else {
      setMsg("Revenue saved.");
      loadBundle(selectedId);
    }
  }

  async function saveCosts() {
    if (!selectedId || !budget) return;
    setSaving(true);
    setMsg(null);
    const r = await fetch(`/api/budget/${selectedId}/lines`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ costLines: gridToCostLines(selectedId, budget.budget_year, costGrid) }),
    });
    setSaving(false);
    if (!r.ok) setMsg(await r.text());
    else {
      setMsg("Costs saved.");
      loadBundle(selectedId);
    }
  }

  async function saveHeadcount(next: LineRow[]) {
    if (!selectedId || !budget) return;
    setSaving(true);
    setMsg(null);
    const r = await fetch(`/api/budget/${selectedId}/lines`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ headcountLines: next, syncStaffFromHeadcount: true }),
    });
    setSaving(false);
    if (!r.ok) setMsg(await r.text());
    else {
      setMsg("Headcount saved.");
      loadBundle(selectedId);
    }
  }

  async function saveCapex(next: LineRow[]) {
    if (!selectedId) return;
    setSaving(true);
    setMsg(null);
    const r = await fetch(`/api/budget/${selectedId}/lines`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capexLines: next }),
    });
    setSaving(false);
    if (!r.ok) setMsg(await r.text());
    else {
      setMsg("CapEx saved.");
      loadBundle(selectedId);
    }
  }

  async function saveOccupancy(next: LineRow[]) {
    if (!selectedId) return;
    setSaving(true);
    setMsg(null);
    const r = await fetch(`/api/budget/${selectedId}/lines`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ occupancyLines: next }),
    });
    setSaving(false);
    if (!r.ok) setMsg(await r.text());
    else {
      setMsg("Occupancy saved.");
      loadBundle(selectedId);
    }
  }

  function onRevChange(rowKey: string, month: number, value: number) {
    setRevGrid((g) => ({
      ...g,
      [rowKey]: { ...g[rowKey], [mk(month)]: value },
    }));
  }

  function onCostChange(rowKey: string, month: number, value: number) {
    if (rowKey === "staff") return;
    setCostGrid((g) => ({
      ...g,
      [rowKey]: { ...g[rowKey], [mk(month)]: value },
    }));
  }

  function openNewBudgetModal() {
    if (!tenantId) return;
    const y = new Date().getFullYear() + 1;
    const firstId = propertiesForTenant[0]?.id ?? "";
    setNewBudgetYear(y);
    setNewBudgetScope("property");
    setNewBudgetPropertyId(firstId);
    setNewBudgetNameTouched(false);
    setNewBudgetError(null);
    setNewBudgetName(suggestNewBudgetName("property", y, firstId));
    setNewBudgetOpen(true);
  }

  async function submitNewBudget() {
    if (!tenantId) return;
    setNewBudgetError(null);
    const y = Math.round(Number(newBudgetYear));
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      setNewBudgetError("Enter a valid budget year between 2000 and 2100.");
      return;
    }
    let property_id: string | null = null;
    let budget_scope: string;
    if (newBudgetScope === "property") {
      const pid = newBudgetPropertyId.trim();
      if (!pid) {
        setNewBudgetError("Select a property for a property budget.");
        return;
      }
      if (!propertiesForTenant.some((p) => p.id === pid)) {
        setNewBudgetError("Selected property is not in your available list.");
        return;
      }
      property_id = pid;
      budget_scope = "property";
    } else if (newBudgetScope === "administration") {
      budget_scope = "administration";
    } else {
      budget_scope = "combined";
    }
    const name =
      newBudgetName.trim() ||
      suggestNewBudgetName(newBudgetScope, y, newBudgetPropertyId);
    setNewBudgetSaving(true);
    const r = await fetch("/api/budget", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        budget_year: y,
        name,
        budget_scope,
        property_id,
      }),
    });
    setNewBudgetSaving(false);
    if (!r.ok) {
      let detail = await r.text();
      try {
        const j = JSON.parse(detail) as { error?: string };
        if (j.error) detail = j.error;
      } catch {
        /* keep text */
      }
      setNewBudgetError(detail || "Could not create budget.");
      return;
    }
    const j = (await r.json()) as { budget: BudgetMeta };
    await loadBudgets(tenantId);
    setSelectedId(j.budget.id);
    setNewBudgetOpen(false);
    setMsg("Budget created.");
  }

  async function exportXlsx() {
    if (!selectedId) return;
    const r = await fetch(`/api/budget/${selectedId}/export`);
    if (!r.ok) {
      alert(await r.text());
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-${selectedId}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runAiForecast() {
    if (!selectedId) return;
    setAiBusy(true);
    setAiText(null);
    const r = await fetch(`/api/budget/${selectedId}/ai-forecast`, { method: "POST" });
    setAiBusy(false);
    if (!r.ok) {
      setAiText(await r.text());
      return;
    }
    const j = (await r.json()) as { explanation: string; byCategory: Record<string, number[]> };
    setAiText(j.explanation);
    setRevGrid((prev) => {
      const next = { ...prev };
      for (const c of BUDGET_REVENUE_CATEGORIES) {
        const arr = j.byCategory[c] ?? [];
        next[c] = emptyMonthRecord(0);
        for (let m = 1; m <= 12; m++) {
          next[c][mk(m)] = arr[m - 1] ?? 0;
        }
      }
      return next;
    });
  }

  const chartData = useMemo(() => {
    if (consolidated && view === "monthly") {
      return consolidated.monthly.map((r) => ({
        name: MONTH_SHORT[r.month - 1],
        revenue: r.revenue,
        costs: r.propertyCosts + r.adminCosts,
      }));
    }
    const cols = quarterKeys(view === "annual" ? "annual" : view === "quarterly" ? "quarterly" : "monthly");
    return cols.map((col) => {
      let rev = 0;
      let cost = 0;
      for (const m of col.months) {
        rev += revTot[mk(m)] ?? 0;
        cost += costTot[mk(m)] ?? 0;
      }
      return { name: col.label, revenue: rev, costs: cost };
    });
  }, [consolidated, revTot, costTot, view]);

  const cashRows = useMemo(() => {
    const capexM = capexCashOutByMonth(capexLines as Parameters<typeof capexCashOutByMonth>[0]);
    let bal = num(budget?.opening_cash_balance);
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const mkk = mk(m);
      const rev = revTot[mkk] ?? 0;
      const cost = costTot[mkk] ?? 0;
      const cx = capexM[mkk] ?? 0;
      const net = rev + cost - cx;
      bal += net;
      rows.push({ month: MONTH_SHORT[m - 1], rev, cost, capex: cx, net, bal });
    }
    return rows;
  }, [revTot, costTot, capexLines, budget]);

  if (!ready) return <p style={{ color: "#666" }}>Loading…</p>;
  if (forbidden) {
    return (
      <main style={{ padding: 24 }}>
        <p style={{ color: "#b00020" }}>You don&apos;t have access to budgeting.</p>
        <Link href="/">Home</Link>
      </main>
    );
  }

  const statusColor =
    budget?.status === "approved" || budget?.status === "active"
      ? "#16a34a"
      : budget?.status === "archived"
        ? "#71717a"
        : "#ca8a04";

  return (
    <main style={{ padding: "16px 20px 40px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <h1 className="vw-admin-page-title" style={{ margin: 0, flex: "1 1 200px" }}>Budget &amp; forecast</h1>
        <select
          className="vw-select"
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value || null)}
          style={{ minWidth: 220 }}
        >
          <option value="">Select budget…</option>
          {budgets.map((b) => {
            const sc = (b.budget_scope ?? "property").toLowerCase();
            const pnm =
              sc === "administration"
                ? "Administration"
                : sc === "combined"
                  ? "Portfolio"
                  : propertiesForTenant.find((p) => p.id === b.property_id)?.name ?? "Property";
            return (
              <option key={b.id} value={b.id}>
                {b.budget_year} · {pnm} · {b.name} ({b.status})
              </option>
            );
          })}
        </select>
        {canManage && (
          <button type="button" className="vw-btn-primary" onClick={() => openNewBudgetModal()}>
            New budget
          </button>
        )}
        {canManage && (
          <label
            className="vw-btn-secondary"
            style={{
              cursor: tenantId && !excelImportBusy ? "pointer" : "not-allowed",
              display: "inline-flex",
              opacity: !tenantId || excelImportBusy ? 0.5 : 1,
            }}
            onClick={(ev) => {
              if (!tenantId || excelImportBusy) {
                ev.preventDefault();
                setMsg("Organization context missing; reload the page or pick a tenant.");
              }
            }}
          >
            <span>{excelImportBusy ? "Importing…" : "Import Excel"}</span>
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              disabled={!tenantId || excelImportBusy}
              style={{ display: "none" }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f || !tenantId) {
                  e.target.value = "";
                  return;
                }
                setExcelImportBusy(true);
                setExcelImportResult(null);
                setMsg(null);
                const fd = new FormData();
                fd.set("tenantId", tenantId);
                fd.set("file", f);
                try {
                  const r = await fetch("/api/budget/import-excel", { method: "POST", body: fd });
                  const text = await r.text();
                  let parsed: {
                    ok?: boolean;
                    error?: string;
                    revenueLines?: number;
                    costLines?: number;
                    propertiesImported?: number;
                    summary?: string;
                    budget?: { id: string };
                    warnings?: string[];
                  } = {};
                  try {
                    parsed = JSON.parse(text) as typeof parsed;
                  } catch {
                    parsed = {};
                  }
                  if (r.ok && parsed.ok && parsed.budget?.id) {
                    setExcelImportResult({
                      ok: true,
                      revenueRows: Number(parsed.revenueLines) || 0,
                      costRows: Number(parsed.costLines) || 0,
                      propertiesImported: Number(parsed.propertiesImported) || 0,
                      summary: parsed.summary,
                    });
                    setMsg(parsed.summary ?? "Import complete.");
                    await loadBudgets(tenantId, parsed.budget.id);
                    await loadBundle(parsed.budget.id);
                  } else {
                    const err = (parsed.error ?? text) || `Import failed (${r.status})`;
                    setExcelImportResult({ ok: false, error: err });
                    setMsg(err);
                  }
                } catch (err) {
                  const message = err instanceof Error ? err.message : "Import failed";
                  setExcelImportResult({ ok: false, error: message });
                  setMsg(message);
                } finally {
                  setExcelImportBusy(false);
                  e.target.value = "";
                }
              }}
            />
          </label>
        )}
        <button type="button" className="vw-btn-secondary" onClick={() => exportXlsx()} disabled={!selectedId}>
          Export Excel
        </button>
        <select
          className="vw-select"
          value={propertyFilter ?? ""}
          onChange={(e) => setPropertyFilter(e.target.value || null)}
        >
          <option value="">All properties</option>
          {propertiesForTenant.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name ?? p.id}
            </option>
          ))}
        </select>
        <select className="vw-select" value={view} onChange={(e) => setView(e.target.value as typeof view)}>
          <option value="monthly">Monthly view</option>
          <option value="quarterly">Quarterly view</option>
          <option value="annual">Annual view</option>
        </select>
        {budget && (
          <span
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              background: `${statusColor}22`,
              color: statusColor,
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {budget.status}
          </span>
        )}
      </div>

      {excelImportResult && (
        <div
          role="status"
          style={{
            marginBottom: 16,
            padding: "12px 14px",
            borderRadius: 8,
            background: excelImportResult.ok ? "#ecfdf5" : "#fef2f2",
            border: `1px solid ${excelImportResult.ok ? "#a7f3d0" : "#fecaca"}`,
            fontSize: 14,
          }}
        >
          {excelImportResult.ok ? (
            <p style={{ margin: 0 }}>
              {excelImportResult.summary ? (
                <strong>{excelImportResult.summary}</strong>
              ) : (
                <>
                  Import finished: <strong>{excelImportResult.revenueRows}</strong> revenue row(s),{" "}
                  <strong>{excelImportResult.costRows}</strong> cost row(s) written.
                </>
              )}
            </p>
          ) : (
            <p style={{ margin: 0, color: "#991b1b" }}>{excelImportResult.error}</p>
          )}
        </div>
      )}

      {tenantId && propertiesForTenant.length > 0 ? (
        <section
          style={{
            border: "1px solid #e4e4e7",
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
            background: "#fafafa",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Portfolio builder</div>
          <p style={{ fontSize: 13, color: "#52525b", margin: "0 0 12px" }}>
            Choose which <strong>property budgets</strong> and the <strong>administration budget</strong> to roll up for the
            consolidated P&amp;L (calendar year <strong>{year}</strong>). Then click <strong>Update portfolio view</strong>.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 8,
              marginBottom: 12,
            }}
          >
            {propertiesForTenant.map((p) => (
              <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={portfolioPropIds.has(p.id)}
                  onChange={(e) => {
                    setPortfolioPropIds((prev) => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(p.id);
                      else n.delete(p.id);
                      return n;
                    });
                  }}
                />
                {p.name ?? p.id}
              </label>
            ))}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={portfolioIncludeAdmin}
                onChange={(e) => setPortfolioIncludeAdmin(e.target.checked)}
              />
              Administration (central)
            </label>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <button type="button" className="vw-btn-primary" onClick={() => void updatePortfolioView()}>
              Update portfolio view
            </button>
            {canManage ? (
              <button type="button" className="vw-btn-secondary" disabled={comboSaving} onClick={() => void saveCurrentCombination()}>
                Save combination
              </button>
            ) : null}
            {combinations.map((c) => (
              <button key={c.id} type="button" className="vw-btn-secondary" onClick={() => applyCombination(c)}>
                {c.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {canManage && budget && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            className="vw-btn-secondary"
            onClick={async () => {
              const pct = Number(prompt("Apply % increase to forked amounts?", "0") ?? "0");
              const ty = Number(prompt("Target year?", String(budget.budget_year + 1)));
              if (!Number.isFinite(ty)) return;
              const r = await fetch(`/api/budget/${budget.id}/fork`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ target_year: ty, apply_pct: pct, name: `${budget.name} (${ty})` }),
              });
              if (!r.ok) alert(await r.text());
              else {
                const j = (await r.json()) as { budget: BudgetMeta };
                if (tenantId) await loadBudgets(tenantId);
                setSelectedId(j.budget.id);
              }
            }}
          >
            Copy / fork budget
          </button>
          <button
            type="button"
            className="vw-btn-secondary"
            onClick={async () => {
              const sy = Number(prompt("Copy actuals from which year?", String(budget.budget_year - 1)));
              if (!Number.isFinite(sy)) return;
              const inc = confirm("Also copy cost actuals?");
              const r = await fetch(`/api/budget/${budget.id}/from-actuals`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ source_year: sy, include_costs: inc }),
              });
              setMsg(r.ok ? "Loaded from actuals." : await r.text());
              loadBundle(budget.id);
            }}
          >
            Copy from last year (actuals)
          </button>
          <label style={{ fontSize: 14 }}>
            Opening cash (€)
            <input
              type="number"
              style={{ marginLeft: 8, width: 120 }}
              defaultValue={num(budget.opening_cash_balance)}
              key={budget.id}
              onBlur={async (e) => {
                const v = Number(e.target.value);
                await fetch(`/api/budget/${budget.id}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ opening_cash_balance: v }),
                });
                loadBundle(budget.id);
              }}
            />
          </label>
          <select
            className="vw-select"
            value={budget.status}
            onChange={async (e) => {
              const st = e.target.value;
              await fetch(`/api/budget/${budget.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ status: st }),
              });
              loadBundle(budget.id);
            }}
          >
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? "vw-tab-active" : "vw-tab-inactive"}
            onClick={() => setTab(t)}
            style={{ textTransform: "capitalize" }}
          >
            {t === "cashflow" ? "Cash flow" : t === "capex" ? "CapEx" : t}
          </button>
        ))}
      </div>

      {msg && (
        <p style={{ color: msg.startsWith("{") ? "#b00020" : "#15803d", marginBottom: 12 }}>{msg}</p>
      )}

      {!selectedId && <p style={{ color: "#666" }}>Create or select a budget to begin.</p>}

      {selectedId && budget && tab === "overview" && (
        <section>
          <h2 style={{ fontSize: 17, margin: "0 0 12px" }}>This budget ({year}) — by property</h2>
          <p style={{ fontSize: 13, color: "#52525b", margin: "0 0 16px" }}>
            Monthly and annual figures from this budget’s stored revenue and cost lines (by property where applicable).
          </p>

          <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>Monthly revenue by property (€)</h3>
          <div style={{ overflowX: "auto", marginBottom: 20 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
              <thead>
                <tr style={{ background: "#f4f4f5" }}>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e4e4e7" }}>Property</th>
                  {MONTH_SHORT.map((m) => (
                    <th key={m} style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e4e4e7" }}>
                      {m}
                    </th>
                  ))}
                  <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e4e4e7" }}>Year</th>
                </tr>
              </thead>
              <tbody>
                {overviewByProperty.rows.map((r) => (
                  <tr key={`rev-${r.key}`}>
                    <td style={{ padding: 6, borderBottom: "1px solid #f4f4f5" }}>{r.label}</td>
                    {r.rev.map((v, i) => (
                      <td key={i} style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #f4f4f5" }}>
                        {v.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                      </td>
                    ))}
                    <td style={{ textAlign: "right", fontWeight: 600, padding: 6, borderBottom: "1px solid #f4f4f5" }}>
                      {r.rev.reduce((a, b) => a + b, 0).toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, background: "#fafafa" }}>
                  <td style={{ padding: 8 }}>Total revenue</td>
                  {overviewByProperty.monthRev.map((v, i) => (
                    <td key={i} style={{ textAlign: "right", padding: 8 }}>
                      {v.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  ))}
                  <td style={{ textAlign: "right", padding: 8 }}>
                    {overviewByProperty.annualRev.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>Monthly costs by property (€)</h3>
          <div style={{ overflowX: "auto", marginBottom: 20 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
              <thead>
                <tr style={{ background: "#f4f4f5" }}>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e4e4e7" }}>Property</th>
                  {MONTH_SHORT.map((m) => (
                    <th key={m} style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e4e4e7" }}>
                      {m}
                    </th>
                  ))}
                  <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e4e4e7" }}>Year</th>
                </tr>
              </thead>
              <tbody>
                {overviewByProperty.rows.map((r) => (
                  <tr key={`cost-${r.key}`}>
                    <td style={{ padding: 6, borderBottom: "1px solid #f4f4f5" }}>{r.label}</td>
                    {r.cost.map((v, i) => (
                      <td key={i} style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #f4f4f5" }}>
                        {v.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                      </td>
                    ))}
                    <td style={{ textAlign: "right", fontWeight: 600, padding: 6, borderBottom: "1px solid #f4f4f5" }}>
                      {r.cost.reduce((a, b) => a + b, 0).toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, background: "#fafafa" }}>
                  <td style={{ padding: 8 }}>Total costs</td>
                  {overviewByProperty.monthCost.map((v, i) => (
                    <td key={i} style={{ textAlign: "right", padding: 8 }}>
                      {v.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  ))}
                  <td style={{ textAlign: "right", padding: 8 }}>
                    {overviewByProperty.annualCost.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>Net income by month (€)</h3>
          <div style={{ overflowX: "auto", marginBottom: 24 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
              <thead>
                <tr style={{ background: "#f4f4f5" }}>
                  <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e4e4e7" }}>Property</th>
                  {MONTH_SHORT.map((m) => (
                    <th key={m} style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e4e4e7" }}>
                      {m}
                    </th>
                  ))}
                  <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e4e4e7" }}>Year</th>
                </tr>
              </thead>
              <tbody>
                {overviewByProperty.rows.map((r) => {
                  const annual = r.rev.reduce((acc, revVal, i) => acc + revVal + r.cost[i], 0);
                  return (
                    <tr key={`net-${r.key}`}>
                      <td style={{ padding: 6, borderBottom: "1px solid #f4f4f5" }}>{r.label}</td>
                      {MONTH_SHORT.map((_, i) => {
                        const net = r.rev[i] + r.cost[i];
                        return (
                          <td key={i} style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #f4f4f5" }}>
                            {net.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                          </td>
                        );
                      })}
                      <td style={{ textAlign: "right", fontWeight: 600, padding: 6, borderBottom: "1px solid #f4f4f5" }}>
                        {annual.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ fontWeight: 700, background: "#fafafa" }}>
                  <td style={{ padding: 8 }}>Total net income</td>
                  {overviewByProperty.monthNet.map((v, i) => (
                    <td key={i} style={{ textAlign: "right", padding: 8 }}>
                      {v.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  ))}
                  <td style={{ textAlign: "right", padding: 8 }}>
                    {overviewByProperty.annualNet.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {consolidated ? (
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: 17, margin: "0 0 12px" }}>Combined portfolio P&amp;L (annual)</h2>
              <table style={{ width: "100%", maxWidth: 720, borderCollapse: "collapse", fontSize: 14, marginBottom: 8 }}>
                <tbody>
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 700, padding: "8px 0", borderBottom: "1px solid #e4e4e7" }}>
                      Revenue (selected properties)
                    </td>
                  </tr>
                  {Object.entries(consolidated.pl.propertyRevenueByPropertyId).map(([pid, amt]) => (
                    <tr key={pid}>
                      <td style={{ padding: "6px 0" }}>{properties.find((p) => p.id === pid)?.name ?? pid.slice(0, 8)}</td>
                      <td style={{ textAlign: "right" }}>€{amt.toLocaleString("en-IE", { maximumFractionDigits: 0 })}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 600 }}>
                    <td style={{ padding: "8px 0", borderTop: "1px solid #e4e4e7" }}>Total property revenue</td>
                    <td style={{ textAlign: "right", borderTop: "1px solid #e4e4e7" }}>
                      €{consolidated.pl.totalPropertyRevenue.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 700, padding: "12px 0 8px", borderBottom: "1px solid #e4e4e7" }}>
                      Property costs
                    </td>
                  </tr>
                  {Object.entries(consolidated.pl.propertyCostsByPropertyId).map(([pid, amt]) => (
                    <tr key={`c-${pid}`}>
                      <td style={{ padding: "6px 0" }}>{properties.find((p) => p.id === pid)?.name ?? pid.slice(0, 8)}</td>
                      <td style={{ textAlign: "right" }}>€{amt.toLocaleString("en-IE", { maximumFractionDigits: 0 })}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 600 }}>
                    <td style={{ padding: "8px 0", borderTop: "1px solid #e4e4e7" }}>Total property costs</td>
                    <td style={{ textAlign: "right", borderTop: "1px solid #e4e4e7" }}>
                      €{consolidated.pl.totalPropertyCosts.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                  <tr style={{ fontWeight: 700 }}>
                    <td style={{ padding: "10px 0" }}>Property net operating income</td>
                    <td style={{ textAlign: "right" }}>€{consolidated.pl.propertyNoi.toLocaleString("en-IE", { maximumFractionDigits: 0 })}</td>
                  </tr>
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 700, padding: "12px 0 8px", borderBottom: "1px solid #e4e4e7" }}>
                      Administration costs (central budget)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 0" }}>Central staff</td>
                    <td style={{ textAlign: "right" }}>
                      €{consolidated.pl.adminCostBuckets.centralStaff.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 0" }}>Central marketing</td>
                    <td style={{ textAlign: "right" }}>
                      €{consolidated.pl.adminCostBuckets.centralMarketing.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 0" }}>Central IT</td>
                    <td style={{ textAlign: "right" }}>
                      €{consolidated.pl.adminCostBuckets.centralIt.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 0" }}>Insurance</td>
                    <td style={{ textAlign: "right" }}>
                      €{consolidated.pl.adminCostBuckets.insurance.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 0" }}>Other admin</td>
                    <td style={{ textAlign: "right" }}>
                      €{consolidated.pl.adminCostBuckets.otherAdmin.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                  <tr style={{ fontWeight: 600 }}>
                    <td style={{ padding: "8px 0", borderTop: "1px solid #e4e4e7" }}>Total administration</td>
                    <td style={{ textAlign: "right", borderTop: "1px solid #e4e4e7" }}>
                      €{consolidated.pl.adminCostBuckets.total.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                  <tr style={{ fontWeight: 700 }}>
                    <td style={{ padding: "10px 0" }}>Net income before CapEx</td>
                    <td style={{ textAlign: "right" }}>€{consolidated.pl.netBeforeCapex.toLocaleString("en-IE", { maximumFractionDigits: 0 })}</td>
                  </tr>
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 700, padding: "12px 0 8px", borderBottom: "1px solid #e4e4e7" }}>
                      CapEx (estimated, by planned date)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 0" }}>Property CapEx</td>
                    <td style={{ textAlign: "right" }}>
                      €{consolidated.pl.propertyCapexTotal.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 0" }}>Admin CapEx</td>
                    <td style={{ textAlign: "right" }}>
                      €{consolidated.pl.adminCapexTotal.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                  <tr style={{ fontWeight: 600 }}>
                    <td style={{ padding: "8px 0" }}>Total CapEx</td>
                    <td style={{ textAlign: "right" }}>
                      €{consolidated.pl.totalCapex.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                  <tr style={{ fontWeight: 700, fontSize: 16 }}>
                    <td style={{ padding: "12px 0", borderTop: "2px solid #18181b" }}>Net income</td>
                    <td style={{ textAlign: "right", borderTop: "2px solid #18181b" }}>
                      €{consolidated.pl.netIncome.toLocaleString("en-IE", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 0" }}>Net margin (on property revenue)</td>
                    <td style={{ textAlign: "right" }}>
                      {consolidated.pl.netMarginPct != null ? `${consolidated.pl.netMarginPct.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p style={{ fontSize: 12, color: "#71717a" }}>
                Bundles included: {consolidated.bundlesUsed.map((b) => b.name).join(", ") || "—"}
              </p>
            </div>
          ) : (
            <p style={{ color: "#71717a", fontSize: 14, marginBottom: 16 }}>
              Use <strong>Portfolio builder</strong> above and click <strong>Update portfolio view</strong> to load the combined
              P&amp;L.
            </p>
          )}

          <h3 style={{ fontSize: 15, margin: "0 0 10px" }}>
            Selected budget only ({budgetScope === "administration" ? "Administration" : "Property"})
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 20 }}>
            {[
              ["Budgeted revenue", Object.values(revTot).reduce((a, b) => a + b, 0)],
              ["Budgeted costs", Object.values(costTot).reduce((a, b) => a + b, 0)],
              [
                "Net income",
                (() => {
                  const tr = Object.values(revTot).reduce((a, b) => a + b, 0);
                  const tc = Object.values(costTot).reduce((a, b) => a + b, 0);
                  return tr + tc;
                })(),
              ],
              [
                "Margin %",
                (() => {
                  const tr = Object.values(revTot).reduce((a, b) => a + b, 0);
                  const tc = Object.values(costTot).reduce((a, b) => a + b, 0);
                  return tr > 0 ? ((tr + tc) / tr) * 100 : 0;
                })(),
              ],
            ].map(([label, v]) => (
              <div key={String(label)} style={{ padding: 16, borderRadius: 12, border: "1px solid #e4e4e7", background: "#fafafa" }}>
                <div style={{ fontSize: 13, color: "#52525b" }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>
                  {label === "Margin %" ? `${(v as number).toFixed(1)}%` : `€${(v as number).toLocaleString("en-IE", { maximumFractionDigits: 0 })}`}
                </div>
              </div>
            ))}
          </div>
          <p style={{ color: "#71717a", fontSize: 14, marginBottom: 12 }}>
            Edit line detail in the Revenue / Costs / Headcount tabs for this budget. Staff on property budgets follows
            headcount. Administration budgets are typically costs-only at the centre.
          </p>
          <div style={{ height: 320, marginBottom: 24 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(v) => [`€${Number(v ?? 0).toLocaleString()}`, ""]} />
                <Legend />
                <Bar dataKey="revenue" fill="#22c55e" name="Revenue" />
                <Bar dataKey="costs" fill="#ef4444" name="Costs" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {selectedId && budget && tab === "revenue" && (
        <section>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => {
                const cat = prompt("Which category row to fill? (e.g. office_rent)") ?? "";
                if (!BUDGET_REVENUE_CATEGORIES.includes(cat as (typeof BUDGET_REVENUE_CATEGORIES)[number])) return;
                const v = Number(prompt("January amount (€)?", "0"));
                if (!Number.isFinite(v)) return;
                setRevGrid((g) => {
                  const next = { ...g, [cat]: { ...g[cat] } };
                  for (let m = 1; m <= 12; m++) next[cat][mk(m)] = v;
                  return next;
                });
              }}
            >
              Fill row (Jan→Dec)
            </button>
            <button
              type="button"
              onClick={() => {
                const p = Number(prompt("% change to apply to all revenue cells?", "5"));
                if (!Number.isFinite(p)) return;
                const f = 1 + p / 100;
                setRevGrid((g) => {
                  const next = { ...g };
                  for (const c of BUDGET_REVENUE_CATEGORIES) {
                    next[c] = { ...next[c] };
                    for (let m = 1; m <= 12; m++) {
                      const k = mk(m);
                      next[c][k] = Math.round((next[c][k] ?? 0) * f * 100) / 100;
                    }
                  }
                  return next;
                });
              }}
            >
              % increase all
            </button>
            {canManage && (
              <button type="button" disabled={aiBusy} onClick={() => runAiForecast()}>
                {aiBusy ? "AI…" : "Generate AI forecast"}
              </button>
            )}
            {canManage && (
              <button type="button" onClick={() => saveRevenue()} disabled={saving}>
                Save revenue
              </button>
            )}
          </div>
          {aiText && (
            <p style={{ background: "#f4f4f5", padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 14 }}>{aiText}</p>
          )}
          <BudgetMonthGrid
            rowKeys={revenueRowKeys}
            rowLabels={revenueLabelsForGrid}
            values={revGrid}
            onChange={onRevChange}
          />
        </section>
      )}

      {selectedId && budget && tab === "costs" && (
        <section>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => {
                const ct = prompt("Cost type key (e.g. cleaning)", "cleaning") ?? "";
                if (!BUDGET_COST_EDITABLE.includes(ct as (typeof BUDGET_COST_EDITABLE)[number])) return;
                const v = Number(prompt("January amount?", "0"));
                if (!Number.isFinite(v)) return;
                setCostGrid((g) => {
                  const next = { ...g, [ct]: { ...g[ct] } };
                  for (let m = 1; m <= 12; m++) next[ct][mk(m)] = v;
                  return next;
                });
              }}
            >
              Fill row
            </button>
            <button
              type="button"
              onClick={() => {
                const p = Number(prompt("% change for all editable cost cells?", "3"));
                if (!Number.isFinite(p)) return;
                const f = 1 + p / 100;
                setCostGrid((g) => {
                  const next = { ...g };
                  for (const c of BUDGET_COST_EDITABLE) {
                    next[c] = { ...next[c] };
                    for (let m = 1; m <= 12; m++) {
                      const k = mk(m);
                      next[c][k] = Math.round((next[c][k] ?? 0) * f * 100) / 100;
                    }
                  }
                  return next;
                });
              }}
            >
              % increase all
            </button>
            {canManage && (
              <button type="button" onClick={() => saveCosts()} disabled={saving}>
                Save costs
              </button>
            )}
          </div>
          <BudgetMonthGrid
            rowKeys={costRowKeysForGrid}
            rowLabels={costLabelsForGrid}
            values={mergedCostGrid}
            onChange={onCostChange}
            readOnlyRowKeys={new Set(["staff"])}
          />
        </section>
      )}

      {selectedId && budget && tab === "headcount" && <HeadcountSection lines={hcLines} year={year} onSave={saveHeadcount} canManage={canManage} />}

      {selectedId && budget && tab === "capex" && (
        <CapexSection lines={capexLines} onSave={saveCapex} canManage={canManage} properties={propertiesForTenant} />
      )}

      {selectedId && budget && tab === "occupancy" && (
        <OccupancySection
          lines={occLines}
          year={year}
          budgetId={selectedId}
          onSave={saveOccupancy}
          canManage={canManage}
          properties={properties}
        />
      )}

      {selectedId && budget && tab === "cashflow" && (
        <section>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f4f4f5" }}>
                <th style={{ padding: 8, textAlign: "left" }}>Month</th>
                <th style={{ padding: 8, textAlign: "right" }}>Revenue</th>
                <th style={{ padding: 8, textAlign: "right" }}>Costs</th>
                <th style={{ padding: 8, textAlign: "right" }}>CapEx</th>
                <th style={{ padding: 8, textAlign: "right" }}>Net</th>
                <th style={{ padding: 8, textAlign: "right" }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {cashRows.map((row) => (
                <tr key={row.month} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: 8 }}>{row.month}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>€{row.rev.toLocaleString()}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>€{row.cost.toLocaleString()}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>€{row.capex.toLocaleString()}</td>
                  <td style={{ padding: 8, textAlign: "right", color: row.net >= 0 ? "#15803d" : "#b91c1c" }}>
                    €{row.net.toLocaleString()}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", color: row.bal >= 0 ? "#15803d" : "#b91c1c", fontWeight: 600 }}>
                    €{row.bal.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {selectedId && budget && tab === "variance" && variance && (
        <VarianceSection
          variance={variance}
          budgets={budgets}
          compareId={compareId}
          setCompareId={setCompareId}
          drill={drill}
          setDrill={setDrill}
          selectedBudgetId={selectedId}
          onReforecast={async () => {
            if (!selectedId) return;
            const r = await fetch(`/api/budget/${selectedId}/reforecast-suggest`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ months_payload: variance.months }),
            });
            const t = await r.json();
            alert(JSON.stringify(t, null, 2));
          }}
        />
      )}

      {newBudgetOpen ? (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !newBudgetSaving) setNewBudgetOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-budget-title"
            style={{
              width: "100%",
              maxWidth: 460,
              background: "#fff",
              borderRadius: 12,
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
              border: "1px solid #e4e4e7",
              padding: "24px 26px",
              maxHeight: "min(90vh, 640px)",
              overflowY: "auto",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="new-budget-title" style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
              New budget
            </h2>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#64748b" }}>
              Create a draft budget for your organization. You can edit lines after it is created.
            </p>

            <div style={{ display: "grid", gap: 18 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: "#334155" }}>Budget year</span>
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  value={newBudgetYear}
                  onChange={(e) => setNewBudgetYear(Number(e.target.value))}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    fontSize: 15,
                    maxWidth: 140,
                  }}
                />
              </label>

              <fieldset style={{ margin: 0, padding: 0, border: "none" }}>
                <legend style={{ fontWeight: 600, fontSize: 14, color: "#334155", marginBottom: 8 }}>Budget type</legend>
                <div style={{ display: "grid", gap: 10 }}>
                  {(
                    [
                      { value: "property" as const, label: "Property budget", sub: "For a specific property" },
                      { value: "administration" as const, label: "Administration budget", sub: "Central costs" },
                      { value: "combined" as const, label: "Portfolio budget", sub: "All properties combined" },
                    ] as const
                  ).map((opt) => (
                    <label
                      key={opt.value}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: `1px solid ${newBudgetScope === opt.value ? "#1a4a4a" : "#e2e8f0"}`,
                        background: newBudgetScope === opt.value ? "#f0fdfa" : "#fafafa",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="new-budget-scope"
                        checked={newBudgetScope === opt.value}
                        onChange={() => {
                          setNewBudgetScope(opt.value);
                          setNewBudgetError(null);
                        }}
                        style={{ marginTop: 3, accentColor: "#1a4a4a" }}
                      />
                      <span>
                        <span style={{ display: "block", fontWeight: 600, fontSize: 14, color: "#0f172a" }}>{opt.label}</span>
                        <span style={{ display: "block", fontSize: 12, color: "#64748b", marginTop: 2 }}>{opt.sub}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {newBudgetScope === "property" ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: "#334155" }}>Property</span>
                  <select
                    value={newBudgetPropertyId}
                    onChange={(e) => {
                      setNewBudgetPropertyId(e.target.value);
                      setNewBudgetError(null);
                    }}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid #cbd5e1",
                      fontSize: 14,
                      background: "#fff",
                    }}
                  >
                    {propertiesForTenant.length === 0 ? (
                      <option value="">No properties available</option>
                    ) : (
                      propertiesForTenant.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name?.trim() ? p.name : p.id}
                        </option>
                      ))
                    )}
                  </select>
                  {propertiesForTenant.length === 0 ? (
                    <span style={{ fontSize: 12, color: "#b45309" }}>Add or scope properties before creating a property budget.</span>
                  ) : null}
                </label>
              ) : null}

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: "#334155" }}>Budget name</span>
                <input
                  type="text"
                  value={newBudgetName}
                  onChange={(e) => {
                    setNewBudgetNameTouched(true);
                    setNewBudgetName(e.target.value);
                  }}
                  placeholder={suggestNewBudgetName(newBudgetScope, newBudgetYear, newBudgetPropertyId)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    fontSize: 14,
                  }}
                />
              </label>

              {newBudgetError ? (
                <p style={{ margin: 0, fontSize: 13, color: "#b91c1c", background: "#fef2f2", padding: "10px 12px", borderRadius: 8 }}>
                  {newBudgetError}
                </p>
              ) : null}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                <button
                  type="button"
                  disabled={newBudgetSaving}
                  onClick={() => !newBudgetSaving && setNewBudgetOpen(false)}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: newBudgetSaving ? "default" : "pointer",
                    color: "#334155",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    newBudgetSaving ||
                    !tenantId ||
                    (newBudgetScope === "property" &&
                      (propertiesForTenant.length === 0 || !String(newBudgetPropertyId).trim()))
                  }
                  onClick={() => void submitNewBudget()}
                  style={{
                    padding: "10px 20px",
                    borderRadius: 8,
                    border: "none",
                    background:
                      newBudgetSaving ||
                      !tenantId ||
                      (newBudgetScope === "property" &&
                        (propertiesForTenant.length === 0 || !String(newBudgetPropertyId).trim()))
                        ? "#94a3b8"
                        : "#1a4a4a",
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor:
                      newBudgetSaving ||
                      !tenantId ||
                      (newBudgetScope === "property" &&
                        (propertiesForTenant.length === 0 || !String(newBudgetPropertyId).trim()))
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {newBudgetSaving ? "Creating…" : "Create"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <p style={{ marginTop: 32, fontSize: 14 }}>
        <Link href="/reports">Reports</Link>
        {" · "}
        <Link href="/reports/net-income">Net income</Link>
        {" · "}
        <Link href="/dashboard">Dashboard</Link>
      </p>
    </main>
  );
}

function HeadcountSection({
  lines,
  year,
  onSave,
  canManage,
}: {
  lines: LineRow[];
  year: number;
  onSave: (next: LineRow[]) => void;
  canManage: boolean;
}) {
  const roles = useMemo(() => {
    const s = new Set<string>();
    for (const r of lines) {
      const rn = String((r as { role_name: string }).role_name ?? "").trim();
      if (rn) s.add(rn);
    }
    return [...s];
  }, [lines]);

  const [local, setLocal] = useState<LineRow[]>([]);
  useEffect(() => {
    setLocal(lines.filter((l) => num((l as { year: unknown }).year) === year));
  }, [lines, year]);

  function cell(role: string, month: number, field: "headcount" | "monthly_cost"): number {
    const row = local.find(
      (l) => String((l as { role_name: string }).role_name) === role && num((l as { month: unknown }).month) === month,
    ) as { headcount?: number; monthly_cost?: number } | undefined;
    return field === "headcount" ? num(row?.headcount) : num(row?.monthly_cost);
  }

  function setCell(role: string, month: number, field: "headcount" | "monthly_cost", v: number) {
    setLocal((prev) => {
      const rest = prev.filter(
        (l) => !(String((l as { role_name: string }).role_name) === role && num((l as { month: unknown }).month) === month),
      );
      const cur = prev.find(
        (l) => String((l as { role_name: string }).role_name) === role && num((l as { month: unknown }).month) === month,
      ) as LineRow | undefined;
      const nextRow = {
        ...cur,
        role_name: role,
        month,
        year,
        headcount: field === "headcount" ? v : num((cur as { headcount?: unknown })?.headcount),
        monthly_cost: field === "monthly_cost" ? v : num((cur as { monthly_cost?: unknown })?.monthly_cost),
      };
      return [...rest, nextRow];
    });
  }

  function addRole() {
    const rn = prompt("Role name?");
    if (!rn?.trim()) return;
    const next = [...local];
    for (let m = 1; m <= 12; m++) {
      next.push({ role_name: rn.trim(), month: m, year, headcount: 0, monthly_cost: 0 });
    }
    setLocal(next);
  }

  const totals = useMemo(() => {
    const hc = emptyMonthRecord(0);
    const cost = emptyMonthRecord(0);
    for (const l of local) {
      const m = num((l as { month: unknown }).month);
      if (m < 1 || m > 12) continue;
      const k = mk(m);
      hc[k] += num((l as { headcount: unknown }).headcount);
      cost[k] += num((l as { monthly_cost: unknown }).monthly_cost);
    }
    return { hc, cost };
  }, [local]);

  return (
    <section>
      {canManage && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button type="button" onClick={addRole}>
            Add role
          </button>
          <button
            type="button"
            onClick={() =>
              onSave(
                local.map((l) => ({
                  role_name: String((l as { role_name: string }).role_name),
                  month: num((l as { month: unknown }).month),
                  year,
                  headcount: num((l as { headcount: unknown }).headcount),
                  monthly_cost: num((l as { monthly_cost: unknown }).monthly_cost),
                })),
              )
            }
          >
            Save headcount
          </button>
        </div>
      )}
      <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
        Totals feed the Staff row on the Costs tab. Two sub-rows per month: headcount (FTE) and monthly loaded cost.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f4f4f5" }}>
              <th style={{ padding: 6, textAlign: "left" }}>Role</th>
              {MONTH_SHORT.map((mo, i) => (
                <th key={mo} colSpan={2} style={{ padding: 6, textAlign: "center" }}>
                  {mo}
                </th>
              ))}
            </tr>
            <tr>
              <th />
              {MONTH_SHORT.map((mo) => (
                <th key={`${mo}-h`} colSpan={2} style={{ fontSize: 11, color: "#666", fontWeight: 400 }}>
                  HC / €
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 6, fontWeight: 600 }}>{role}</td>
                {MONTH_SHORT.map((_, mi) => {
                  const m = mi + 1;
                  return (
                    <td key={m} colSpan={2} style={{ padding: 4 }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <input
                          type="number"
                          style={{ width: 44 }}
                          value={cell(role, m, "headcount")}
                          disabled={!canManage}
                          onChange={(e) => setCell(role, m, "headcount", Number(e.target.value))}
                        />
                        <input
                          type="number"
                          style={{ width: 72 }}
                          value={cell(role, m, "monthly_cost")}
                          disabled={!canManage}
                          onChange={(e) => setCell(role, m, "monthly_cost", Number(e.target.value))}
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr style={{ fontWeight: 700, background: "#fafafa" }}>
              <td>Total HC / €</td>
              {MONTH_SHORT.map((_, mi) => {
                const m = mi + 1;
                const k = mk(m);
                return (
                  <td key={m} colSpan={2} style={{ padding: 6 }}>
                    {totals.hc[k]} / €{totals.cost[k].toLocaleString()}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CapexSection({
  lines,
  onSave,
  canManage,
  properties,
}: {
  lines: LineRow[];
  onSave: (next: LineRow[]) => void;
  canManage: boolean;
  properties: { id: string; name: string | null }[];
}) {
  const [rows, setRows] = useState<LineRow[]>(lines);
  useEffect(() => {
    setRows(lines);
  }, [lines]);

  return (
    <section>
      {canManage && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            onClick={() =>
              setRows((r) => [
                ...r,
                {
                  item_name: "New item",
                  category: "equipment",
                  planned_date: new Date().toISOString().slice(0, 10),
                  estimated_cost: 0,
                  actual_cost: 0,
                  status: "planned",
                  property_id: null,
                },
              ])
            }
          >
            Add CapEx
          </button>
          <button type="button" onClick={() => onSave(rows)}>
            Save CapEx
          </button>
        </div>
      )}
      <div style={{ height: 240, marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={[
              { q: "Q1", v: rows.reduce((a, r) => {
                const d = String((r as { planned_date: string | null }).planned_date ?? "");
                const m = Number(d.slice(5, 7));
                if (m >= 1 && m <= 3) return a + num((r as { estimated_cost: unknown }).estimated_cost);
                return a;
              }, 0) },
              { q: "Q2", v: rows.reduce((a, r) => {
                const d = String((r as { planned_date: string | null }).planned_date ?? "");
                const m = Number(d.slice(5, 7));
                if (m >= 4 && m <= 6) return a + num((r as { estimated_cost: unknown }).estimated_cost);
                return a;
              }, 0) },
              { q: "Q3", v: rows.reduce((a, r) => {
                const d = String((r as { planned_date: string | null }).planned_date ?? "");
                const m = Number(d.slice(5, 7));
                if (m >= 7 && m <= 9) return a + num((r as { estimated_cost: unknown }).estimated_cost);
                return a;
              }, 0) },
              { q: "Q4", v: rows.reduce((a, r) => {
                const d = String((r as { planned_date: string | null }).planned_date ?? "");
                const m = Number(d.slice(5, 7));
                if (m >= 10 && m <= 12) return a + num((r as { estimated_cost: unknown }).estimated_cost);
                return a;
              }, 0) },
            ]}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="q" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="v" fill="#6366f1" name="Est. CapEx €" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f4f4f5" }}>
            {["Item", "Category", "Property", "Planned", "Est €", "Actual €", "Status", "Notes"].map((h) => (
              <th key={h} style={{ padding: 8, textAlign: "left" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 6 }}>
                <input
                  value={String((row as { item_name: string }).item_name ?? "")}
                  disabled={!canManage}
                  onChange={(e) => {
                    const next = [...rows];
                    (next[i] as { item_name: string }).item_name = e.target.value;
                    setRows(next);
                  }}
                />
              </td>
              <td style={{ padding: 6 }}>
                <select
                  value={String((row as { category: string }).category ?? "other")}
                  disabled={!canManage}
                  onChange={(e) => {
                    const next = [...rows];
                    (next[i] as { category: string }).category = e.target.value;
                    setRows(next);
                  }}
                >
                  {["renovation", "equipment", "furniture", "it", "other"].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </td>
              <td style={{ padding: 6 }}>
                <select
                  value={String((row as { property_id: string | null }).property_id ?? "")}
                  disabled={!canManage}
                  onChange={(e) => {
                    const next = [...rows];
                    (next[i] as { property_id: string | null }).property_id = e.target.value || null;
                    setRows(next);
                  }}
                >
                  <option value="">Portfolio</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </td>
              <td style={{ padding: 6 }}>
                <input
                  type="date"
                  value={String((row as { planned_date: string | null }).planned_date ?? "").slice(0, 10)}
                  disabled={!canManage}
                  onChange={(e) => {
                    const next = [...rows];
                    (next[i] as { planned_date: string | null }).planned_date = e.target.value;
                    setRows(next);
                  }}
                />
              </td>
              <td style={{ padding: 6 }}>
                <input
                  type="number"
                  value={num((row as { estimated_cost: unknown }).estimated_cost)}
                  disabled={!canManage}
                  onChange={(e) => {
                    const next = [...rows];
                    (next[i] as { estimated_cost: number }).estimated_cost = Number(e.target.value);
                    setRows(next);
                  }}
                />
              </td>
              <td style={{ padding: 6 }}>
                <input
                  type="number"
                  value={num((row as { actual_cost: unknown }).actual_cost)}
                  disabled={!canManage}
                  onChange={(e) => {
                    const next = [...rows];
                    (next[i] as { actual_cost: number }).actual_cost = Number(e.target.value);
                    setRows(next);
                  }}
                />
              </td>
              <td style={{ padding: 6 }}>
                <select
                  value={String((row as { status: string }).status ?? "planned")}
                  disabled={!canManage}
                  onChange={(e) => {
                    const next = [...rows];
                    (next[i] as { status: string }).status = e.target.value;
                    setRows(next);
                  }}
                >
                  {["planned", "approved", "in_progress", "completed"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td style={{ padding: 6 }}>
                <input
                  value={String((row as { notes: string | null }).notes ?? "")}
                  disabled={!canManage}
                  onChange={(e) => {
                    const next = [...rows];
                    (next[i] as { notes: string | null }).notes = e.target.value;
                    setRows(next);
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function OccupancySection({
  lines,
  year,
  onSave,
  canManage,
  properties,
  budgetId: _budgetId,
}: {
  lines: LineRow[];
  year: number;
  budgetId: string;
  onSave: (next: LineRow[]) => void;
  canManage: boolean;
  properties: { id: string; name: string | null }[];
}) {
  const [grid, setGrid] = useState<LineRow[]>([]);
  useEffect(() => {
    setGrid(lines.filter((l) => num((l as { year: unknown }).year) === year));
  }, [lines, year]);

  function key(pid: string | null, st: string) {
    return `${pid ?? "p"}:${st}`;
  }

  const combos = useMemo(() => {
    const out: { pid: string | null; pname: string; st: string }[] = [];
    for (const p of properties) {
      for (const st of BUDGET_OCCUPANCY_SPACE_TYPES) {
        out.push({ pid: p.id, pname: p.name ?? p.id, st });
      }
    }
    if (out.length === 0) {
      for (const st of BUDGET_OCCUPANCY_SPACE_TYPES) {
        out.push({ pid: null, pname: "Portfolio", st });
      }
    }
    return out;
  }, [properties]);

  function pct(pid: string | null, st: string, month: number): number {
    const row = grid.find(
      (l) =>
        String((l as { space_type: string }).space_type) === st &&
        num((l as { month: unknown }).month) === month &&
        (l as { property_id: string | null }).property_id === pid,
    );
    return num((row as { target_occupancy_pct?: unknown } | undefined)?.target_occupancy_pct);
  }

  function setPct(pid: string | null, st: string, month: number, v: number) {
    setGrid((prev) => {
      const rest = prev.filter(
        (l) =>
          !(
            String((l as { space_type: string }).space_type) === st &&
            num((l as { month: unknown }).month) === month &&
            (l as { property_id: string | null }).property_id === pid
          ),
      );
      return [...rest, { property_id: pid, space_type: st, month, year, target_occupancy_pct: v }];
    });
  }

  return (
    <section>
      {canManage && (
        <button type="button" onClick={() => onSave(grid)} style={{ marginBottom: 12 }}>
          Save occupancy targets
        </button>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f4f4f5" }}>
              <th style={{ padding: 8, textAlign: "left" }}>Property / type</th>
              {MONTH_SHORT.map((m) => (
                <th key={m} style={{ padding: 8 }}>
                  {m}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {combos.map((c) => (
              <tr key={key(c.pid, c.st)} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 8 }}>
                  {c.pname} — {BUDGET_OCCUPANCY_LABELS[c.st as keyof typeof BUDGET_OCCUPANCY_LABELS] ?? c.st}
                </td>
                {MONTH_SHORT.map((_, mi) => {
                  const m = mi + 1;
                  return (
                    <td key={m} style={{ padding: 4 }}>
                      <input
                        type="number"
                        style={{ width: 56 }}
                        disabled={!canManage}
                        value={pct(c.pid, c.st, m)}
                        onChange={(e) => setPct(c.pid, c.st, m, Number(e.target.value))}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 16, color: "#666", fontSize: 13 }}>
        Overlay vs actual occupancy: use the owner dashboard analytics after you record occupancy in historical imports or operational data.
      </p>
      <div style={{ height: 220, marginTop: 12 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={MONTH_SHORT.map((label, i) => {
              const m = i + 1;
              const avg =
                combos.length > 0
                  ? combos.reduce((a, c) => a + pct(c.pid, c.st, m), 0) / combos.length
                  : 0;
              return { label, target: avg };
            })}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Line type="monotone" dataKey="target" stroke="#8b5cf6" name="Avg target %" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function VarianceSection({
  variance,
  budgets,
  compareId,
  setCompareId,
  drill,
  setDrill,
  selectedBudgetId,
  onReforecast,
}: {
  variance: { months: Array<{ month: number; budgetRevenue: number; actualRevenue: number; budgetCost: number; actualCosts: number }> };
  budgets: BudgetMeta[];
  compareId: string | null;
  setCompareId: (id: string | null) => void;
  drill: string | null;
  setDrill: (s: string | null) => void;
  selectedBudgetId: string;
  onReforecast: () => void;
}) {
  return (
    <section>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <label>
          Compare to budget{" "}
          <select value={compareId ?? ""} onChange={(e) => setCompareId(e.target.value || null)}>
            <option value="">—</option>
            {budgets.filter((b) => b.id !== selectedBudgetId).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.budget_year})
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onReforecast}>
          AI reforecast note
        </button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f4f4f5" }}>
            <th style={{ padding: 8 }}>Month</th>
            <th style={{ padding: 8, textAlign: "right" }}>Rev budget</th>
            <th style={{ padding: 8, textAlign: "right" }}>Rev actual</th>
            <th style={{ padding: 8, textAlign: "right" }}>Δ €</th>
            <th style={{ padding: 8, textAlign: "right" }}>Δ %</th>
            <th style={{ padding: 8, textAlign: "right" }}>Cost budget</th>
            <th style={{ padding: 8, textAlign: "right" }}>Cost actual</th>
            <th style={{ padding: 8, textAlign: "right" }}>Δ €</th>
          </tr>
        </thead>
        <tbody>
          {variance.months.map((row) => {
            const dv = row.actualRevenue - row.budgetRevenue;
            const dp = row.budgetRevenue > 0 ? (dv / row.budgetRevenue) * 100 : 0;
            const dc = row.actualCosts - row.budgetCost;
            const revGood = dv >= 0;
            const costGood = dc <= 0;
            const within = Math.abs(dp) <= 5;
            return (
              <tr key={row.month} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 8 }}>{MONTH_SHORT[row.month - 1]}</td>
                <td style={{ padding: 8, textAlign: "right" }}>€{row.budgetRevenue.toLocaleString()}</td>
                <td style={{ padding: 8, textAlign: "right" }}>
                  <button type="button" style={{ border: "none", background: "none", cursor: "pointer", color: "#2563eb" }} onClick={() => setDrill(`rev-${row.month}`)}>
                    €{row.actualRevenue.toLocaleString()}
                  </button>
                </td>
                <td style={{ padding: 8, textAlign: "right", color: revGood ? "#15803d" : "#b91c1c" }}>€{dv.toLocaleString()}</td>
                <td
                  style={{
                    padding: 8,
                    textAlign: "right",
                    color: within ? "#ca8a04" : Math.abs(dp) > 10 ? "#b91c1c" : "#15803d",
                  }}
                >
                  {dp.toFixed(1)}%
                </td>
                <td style={{ padding: 8, textAlign: "right" }}>€{row.budgetCost.toLocaleString()}</td>
                <td style={{ padding: 8, textAlign: "right" }}>
                  <button type="button" style={{ border: "none", background: "none", cursor: "pointer", color: "#2563eb" }} onClick={() => setDrill(`cost-${row.month}`)}>
                    €{row.actualCosts.toLocaleString()}
                  </button>
                </td>
                <td style={{ padding: 8, textAlign: "right", color: costGood ? "#15803d" : "#b91c1c" }}>€{dc.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {drill && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setDrill(null)}
        >
          <div
            style={{ background: "white", padding: 24, borderRadius: 12, maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Drill-down</h3>
            <p style={{ fontSize: 14, color: "#444" }}>
              Totals combine <strong>historical_revenue</strong> and <strong>historical_costs</strong> (Procountor / imports) for
              the selected properties. Lease invoices and confirmed bookings are loaded for context in the API; extend this modal
              to list invoice lines per month if needed.
            </p>
            <button type="button" onClick={() => setDrill(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
