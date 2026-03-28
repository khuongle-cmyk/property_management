import { decodeProcountorFileText } from "@/lib/procountor/decode";
import { parseFinNumber } from "@/lib/procountor/finnish-number";

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

export const PROCOUNTOR_COST_ACCOUNT_MAP: Record<string, string> = {
  "4000": "purchases",
  "4001": "cleaning_supplies",
  "4002": "cleaning_equipment",
  "4003": "catering",
  "40031": "catering_billable",
  "4450": "subcontracting",
  "4451": "subcontracting_admin",
  "4480": "hired_labor",
  "4491": "premises_cleaning",
  "4492": "premises_mats",
  "4493": "premises_it",
  "44933": "data_transfer",
  "4494": "premises_maintenance",
  "44941": "premises_maintenance_billable",
  "4495": "postal",
  "44951": "postal_billable",
  "4496": "event_costs",
  "4500": "rent",
  "4501": "electricity",
  "4600": "premises_costs",
  "4601": "printing",
  "4602": "equipment_costs",
  "4603": "equipment_rental",
  "4605": "coffee_machine",
  "4610": "client_entertainment",
  "5000": "salaries",
  "5100": "salary_additions",
  "5300": "holiday_pay",
  "5400": "benefits_in_kind",
  "5990": "benefits_contra",
  "6130": "pension",
  "6300": "social_security",
  "6400": "accident_insurance",
  "6410": "unemployment_insurance",
  "7010": "staff_meetings",
  "7030": "occupational_health",
  "7070": "meal_benefits",
  "7160": "staff_gifts",
  "7170": "other_staff_costs",
  "7610": "vehicle_costs",
  "7700": "it_software",
  "7710": "equipment_leasing",
  "7770": "other_equipment",
  "7800": "travel",
  "8000": "sales_costs",
  "8050": "marketing",
  "8380": "accounting",
  "8451": "unallocated_invoices",
  "8500": "telecom",
  "8560": "banking_costs",
  "8600": "insurance",
  "8680": "other_admin",
  "8890": "reconciliation",
  "9160": "financial_income",
  "9440": "interest_costs",
};

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

    const accountCode = accountMatch[1];
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
