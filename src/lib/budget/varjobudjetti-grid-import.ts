import * as XLSX from "xlsx";

/**
 * Excel sheet tab → exact `properties.name` to resolve (after {@link normalizeMatchKey}).
 * Only these sheets are imported; all other tabs (totals, payroll, marketing, etc.) are ignored.
 */
export const SHEET_PROPERTY_MAP = {
  E2: "Erottaja2",
  Freda: "Freda",
  Ruoholahti: "P5",
  Sähkötalo: "Sähkis",
  Skylounge: "SkyLounge",
} as const;

/** Process sheets in this order (stable import / warnings). */
export const VARJO_PROPERTY_SHEET_ORDER = ["E2", "Freda", "Ruoholahti", "Sähkötalo", "Skylounge"] as const;

export type VarjoPropertySheetName = (typeof VARJO_PROPERTY_SHEET_ORDER)[number];

/** Excel row (1-based) → revenue category (budget_revenue_lines.category). */
export const VARJO_REVENUE_ROW_MAP: Record<number, string> = {
  3: "office_rent",
  4: "hot_desk",
  5: "virtual_office",
  6: "additional_services",
};

/** Excel row (1-based) → cost_type (budget_cost_lines.cost_type). */
export const VARJO_COST_ROW_MAP: Record<number, string> = {
  10: "other", // Aine ja tarvike → purchases-like
  11: "cleaning",
  12: "it_infrastructure",
  13: "property_management", // Huolto → premises maintenance
  14: "staff",
  15: "utilities", // Toimitilakulut
  16: "capex", // Kone ja kalusto
  17: "marketing",
  18: "property_management", // Hallinto
  19: "other", // Vuokra (lease) — no dedicated bucket in app
};

/** Normalize for matching sheet names / property names (strip diacritics, lower). */
export function normalizeMatchKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function yearFromVarjoFileName(fileName: string): number | null {
  const m = String(fileName).match(/(20[0-9]{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) && y >= 2000 && y <= 2100 ? y : null;
}

export function findWorksheetName(workbook: XLSX.WorkBook, wanted: string): string | null {
  const wk = normalizeMatchKey(wanted);
  const hit = workbook.SheetNames.find((n) => normalizeMatchKey(n) === wk);
  return hit ?? null;
}

/**
 * Resolve DB row by mapped display name (normalized equality on `properties.name`).
 */
export function findPropertyIdByMappedName(
  expectedPropertyName: string,
  properties: Array<{ id: string; name: string | null }>,
): { propertyId: string | null; matchedName: string | null } {
  const want = normalizeMatchKey(expectedPropertyName);
  if (!want) return { propertyId: null, matchedName: null };
  for (const p of properties) {
    const pn = normalizeMatchKey(p.name ?? "");
    if (pn && pn === want) {
      return { propertyId: p.id, matchedName: p.name };
    }
  }
  return { propertyId: null, matchedName: null };
}

function parseAmount(cell: unknown): number {
  if (cell == null || cell === "") return 0;
  if (typeof cell === "number" && Number.isFinite(cell)) return cell;
  const s = String(cell).trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Column B..M → months 1..12 (0-based col indices 1..12). */
const MONTH_COL_START = 1;
const MONTH_COL_END = 12;

export type ParsedVarjoSheetResult = {
  sheetName: string;
  propertyId: string | null;
  matchedPropertyName: string | null;
  revenueLineCount: number;
  costLineCount: number;
  revenueRows: Array<{
    month: number;
    year: number;
    category: string;
    budgeted_amount: number;
    property_id: string;
  }>;
  costRows: Array<{
    month: number;
    year: number;
    cost_type: string;
    budgeted_amount: number;
    property_id: string;
  }>;
};

export function parseVarjoPropertySheet(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  year: number,
  propertyId: string,
): Omit<ParsedVarjoSheetResult, "propertyId" | "matchedPropertyName"> {
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as (string | number | null)[][];

  const revenueRows: ParsedVarjoSheetResult["revenueRows"] = [];
  const costRows: ParsedVarjoSheetResult["costRows"] = [];

  for (const [excelRow, category] of Object.entries(VARJO_REVENUE_ROW_MAP)) {
    const r = rows[Number(excelRow) - 1];
    if (!r) continue;
    for (let col = MONTH_COL_START; col <= MONTH_COL_END; col++) {
      const month = col - MONTH_COL_START + 1;
      const amt = parseAmount(r[col]);
      revenueRows.push({
        month,
        year,
        category,
        budgeted_amount: amt,
        property_id: propertyId,
      });
    }
  }

  for (const [excelRow, cost_type] of Object.entries(VARJO_COST_ROW_MAP)) {
    const r = rows[Number(excelRow) - 1];
    if (!r) continue;
    for (let col = MONTH_COL_START; col <= MONTH_COL_END; col++) {
      const month = col - MONTH_COL_START + 1;
      const amt = parseAmount(r[col]);
      costRows.push({
        month,
        year,
        cost_type,
        budgeted_amount: amt,
        property_id: propertyId,
      });
    }
  }

  return {
    sheetName,
    revenueLineCount: revenueRows.length,
    costLineCount: costRows.length,
    revenueRows,
    costRows,
  };
}

export type VarjoWorkbookImportParse = {
  year: number;
  sheets: ParsedVarjoSheetResult[];
  skippedSheets: string[];
  warnings: string[];
};

export function parseVarjoAnnualWorkbook(
  fileName: string,
  buffer: ArrayBuffer,
  properties: Array<{ id: string; name: string | null }>,
): VarjoWorkbookImportParse {
  const wb = XLSX.read(buffer, { type: "array" });
  const yearGuess = yearFromVarjoFileName(fileName) ?? new Date().getFullYear();

  const sheets: ParsedVarjoSheetResult[] = [];
  const skippedSheets: string[] = [];
  const warnings: string[] = [];

  for (const wanted of VARJO_PROPERTY_SHEET_ORDER) {
    const actualName = findWorksheetName(wb, wanted);
    if (!actualName) {
      skippedSheets.push(wanted);
      warnings.push(`Sheet "${wanted}" not found in workbook.`);
      continue;
    }
    const ws = wb.Sheets[actualName];
    if (!ws) {
      skippedSheets.push(wanted);
      continue;
    }
    const mappedName = SHEET_PROPERTY_MAP[wanted];
    const { propertyId, matchedName } = findPropertyIdByMappedName(mappedName, properties);
    if (!propertyId) {
      skippedSheets.push(actualName);
      warnings.push(
        `Could not find property "${mappedName}" for sheet "${actualName}" (check properties.name matches the import map).`,
      );
      continue;
    }
    const parsed = parseVarjoPropertySheet(ws, actualName, yearGuess, propertyId);
    sheets.push({
      ...parsed,
      propertyId,
      matchedPropertyName: matchedName,
    });
  }

  return { year: yearGuess, sheets, skippedSheets, warnings };
}
