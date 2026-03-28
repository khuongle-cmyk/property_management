import { decodeProcountorFileText } from "@/lib/procountor/decode";
import { parseFinNumber } from "@/lib/procountor/finnish-number";
import { mapAccountCodeToHistoricalCostType } from "@/lib/reports/net-income-cost-accounts";

export type RevenueCategory =
  | "office_rent"
  | "meeting_room_revenue"
  | "hot_desk_revenue"
  | "venue_revenue"
  | "virtual_office_revenue"
  | "furniture_revenue"
  | "additional_services"
  | "other_revenue";

export type PreviewRow = Record<string, string | number | null>;

export const PROCOUNTOR_REVENUE_ACCOUNT_MAP: Record<string, RevenueCategory> = {
  "3010": "office_rent",
  "3020": "hot_desk_revenue",
  "3030": "virtual_office_revenue",
  "3040": "meeting_room_revenue",
  "3050": "venue_revenue",
  "3060": "furniture_revenue",
  "3100": "additional_services",
  "3101": "additional_services",
  "3590": "other_revenue",
};

/** Ledger accounts that appear as cost lines in Procountor Tuloslaskelma imports. */
const PROCOUNTOR_COST_ACCOUNT_KEYS = [
  "4000",
  "4001",
  "4002",
  "4003",
  "40031",
  "4450",
  "4451",
  "4480",
  "4491",
  "4492",
  "4493",
  "44933",
  "4494",
  "44941",
  "4495",
  "44951",
  "4496",
  "4500",
  "4501",
  "4600",
  "4601",
  "4602",
  "4603",
  "4605",
  "4610",
  "5000",
  "5100",
  "5300",
  "5400",
  "5990",
  "6130",
  "6300",
  "6400",
  "6410",
  "7010",
  "7030",
  "7070",
  "7160",
  "7170",
  "7610",
  "7700",
  "7710",
  "7770",
  "7800",
  "8000",
  "8050",
  "8380",
  "8451",
  "8500",
  "8560",
  "8600",
  "8680",
  "8890",
  "9160",
  "9440",
] as const;

/** account_code → normalized cost_type (aligned with historical_costs + net-income mapping). */
export const PROCOUNTOR_COST_ACCOUNT_MAP: Record<string, string> = Object.fromEntries(
  PROCOUNTOR_COST_ACCOUNT_KEYS.map((code) => [code, mapAccountCodeToHistoricalCostType(code)]),
);

export type TuloslaskelmaParseOptions = {
  /** Log parse steps (server terminal or browser console). */
  debug?: boolean;
};

/**
 * Parse Procountor Tuloslaskelma CSV text (ISO-8859-1 decoded; semicolon-separated).
 */
export function parseTuloslaskelmaText(
  text: string,
  propertyId: string | null,
  options?: TuloslaskelmaParseOptions,
): PreviewRow[] {
  const debug = !!options?.debug;
  const log = (...args: unknown[]) => {
    if (debug) console.log("[procountor/tuloslaskelma]", ...args);
  };

  if (debug) {
    console.log("[procountor/tuloslaskelma] File text first 500 chars:", text.substring(0, 500));
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  log("Total non-empty lines:", lines.length);

  for (let i = 0; i < Math.min(5, lines.length); i++) {
    log("Row line", i + 1, ":", lines[i]);
  }

  const monthByCol: Array<{ colIdx: number; month: number; year: number }> = [];
  let businessId: string | null = null;
  let propertyRaw: string | null = null;
  let year: number | null = null;
  let rangeFrom: string | null = null;
  let rangeTo: string | null = null;
  let foundMonthHeader = false;
  const out: PreviewRow[] = [];
  let accountRowsLogged = 0;

  for (const line of lines) {
    const cols = line.split(";").map((c) => c.trim());
    const first = cols[0] ?? "";
    const lowerFirst = first.toLowerCase();
    const second = cols[1] ?? "";

    if (lowerFirst === "y-tunnus") businessId = second || null;
    if (lowerFirst === "nimikkeet") propertyRaw = second || null;
    if (lowerFirst === "tositepvm") {
      const range = second.match(/(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/);
      if (range) {
        rangeFrom = `${range[3]}-${range[2]}-${range[1]}`;
        rangeTo = `${range[6]}-${range[5]}-${range[4]}`;
      }
      const m = second.match(/(\d{4})\s*$/);
      if (m) year = Number(m[1]);
    }

    if (!foundMonthHeader) {
      const candidates: Array<{ colIdx: number; month: number; year: number }> = [];
      for (let i = 1; i < cols.length; i++) {
        const c = cols[i];
        const m = c.match(/^(\d{1,2})\/(\d{4})$/);
        if (!m) continue;
        candidates.push({ colIdx: i, month: Number(m[1]), year: Number(m[2]) });
      }
      if (candidates.length >= 12) {
        monthByCol.splice(0, monthByCol.length, ...candidates.slice(0, 12));
        foundMonthHeader = true;
        log("Month header detected; first 12 columns:", monthByCol);
      }
      continue;
    }

    const cell = first.trim();
    const accountMatch = cell.match(/(\d{4,5}),\s*(.+)/);
    if (!accountMatch) continue;

    const accountCode = accountMatch[1].trim();
    const accountName = accountMatch[2]?.trim() ?? "";

    if (debug && accountRowsLogged < 5) {
      log("Parsed account code:", accountCode, "Name:", accountName);
      accountRowsLogged++;
    }

    for (const mc of monthByCol) {
      const rawCell = cols[mc.colIdx] ?? "";
      const value =
        typeof rawCell === "number"
          ? (Number.isFinite(rawCell) ? rawCell : 0)
          : parseFinNumber(String(rawCell));
      if (!value) continue;
      const revenueCategory = PROCOUNTOR_REVENUE_ACCOUNT_MAP[accountCode];
      const costType = PROCOUNTOR_COST_ACCOUNT_MAP[accountCode];
      if (!revenueCategory && !costType) continue;
      if (revenueCategory) {
        const amount = Math.abs(value);
        const row: PreviewRow = {
          property_id: propertyId ?? null,
          property: propertyRaw,
          company_business_id: businessId,
          account_code: accountCode,
          account_name: accountName,
          category: revenueCategory,
          year: mc.year,
          month: mc.month,
          office_rent_revenue: 0,
          meeting_room_revenue: 0,
          hot_desk_revenue: 0,
          venue_revenue: 0,
          virtual_office_revenue: 0,
          furniture_revenue: 0,
          additional_services_revenue: 0,
          total_revenue: amount,
        };
        if (revenueCategory === "office_rent") row.office_rent_revenue = amount;
        else if (revenueCategory === "meeting_room_revenue") row.meeting_room_revenue = amount;
        else if (revenueCategory === "hot_desk_revenue") row.hot_desk_revenue = amount;
        else if (revenueCategory === "venue_revenue") row.venue_revenue = amount;
        else if (revenueCategory === "virtual_office_revenue") row.virtual_office_revenue = amount;
        else if (revenueCategory === "furniture_revenue") row.furniture_revenue = amount;
        else row.additional_services_revenue = amount;
        out.push(row);
      } else if (costType) {
        const amountAbs = Math.abs(value);
        const lastDay = new Date(Date.UTC(mc.year, mc.month, 0)).toISOString().slice(0, 10);
        out.push({
          property_id: propertyId ?? null,
          property: propertyRaw,
          company_business_id: businessId,
          account_code: accountCode,
          account_name: accountName,
          cost_type: costType,
          description: accountName,
          date: lastDay,
          year: mc.year,
          month: mc.month,
          amount_ex_vat: amountAbs,
          vat_amount: 0,
          total_amount: amountAbs,
        });
      }
    }
  }

  log("Parsed preview / data rows:", out.length);

  return out.map((r) => ({
    ...r,
    __detected_range_from: rangeFrom,
    __detected_range_to: rangeTo,
  }));
}

export function parseTuloslaskelmaFromArrayBuffer(
  buffer: ArrayBuffer,
  propertyId: string | null,
  options?: TuloslaskelmaParseOptions,
): PreviewRow[] {
  const text = decodeProcountorFileText(buffer);
  return parseTuloslaskelmaText(text, propertyId, options);
}

const TULOS_AGG_REVENUE_KEYS = [
  "office_rent_revenue",
  "meeting_room_revenue",
  "hot_desk_revenue",
  "venue_revenue",
  "virtual_office_revenue",
  "furniture_revenue",
  "additional_services_revenue",
] as const;

/**
 * One parsed Tuloslaskelma row = one ledger account × one month (only one category column set).
 * historical_revenue has UNIQUE(property_id, year, month) — importing many rows without merging
 * leaves only the first insert; this sums all accounts into one row per month.
 */
export function aggregateTuloslaskelmaRevenueRowsForProperty(
  rows: PreviewRow[],
  propertyId: string,
  propertyName: string,
): PreviewRow[] {
  const num = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const map = new Map<string, PreviewRow>();

  for (const r of rows) {
    if (num(r.total_revenue) <= 0) continue;
    const y = Number(r.year);
    const mo = Number(r.month);
    if (!Number.isInteger(y) || !Number.isInteger(mo) || mo < 1 || mo > 12) continue;
    const key = `${y}|${mo}`;
    const ex = map.get(key);
    if (!ex) {
      const row: PreviewRow = {
        property_id: propertyId,
        property: propertyName,
        year: y,
        month: mo,
        office_rent_revenue: num(r.office_rent_revenue),
        meeting_room_revenue: num(r.meeting_room_revenue),
        hot_desk_revenue: num(r.hot_desk_revenue),
        venue_revenue: num(r.venue_revenue),
        virtual_office_revenue: num(r.virtual_office_revenue),
        furniture_revenue: num(r.furniture_revenue),
        additional_services_revenue: num(r.additional_services_revenue),
        total_revenue: num(r.total_revenue),
      };
      if (r.account_code != null) row.account_code = r.account_code;
      if (r.account_name != null) row.account_name = r.account_name;
      if (r.category != null) row.category = r.category;
      map.set(key, row);
    } else {
      for (const k of TULOS_AGG_REVENUE_KEYS) {
        ex[k] = num(ex[k]) + num(r[k]);
      }
      ex.total_revenue = num(ex.total_revenue) + num(r.total_revenue);
    }
  }

  return Array.from(map.values());
}
