import { buildRentRollReport } from "./rent-roll-builder";
import type { RentRollSourceRows } from "./rent-roll-builder";
import type {
  NetIncomeMonthRow,
  NetIncomeReportModel,
  PropertyCostBreakdown,
  PropertyCostEntryRow,
  PropertyRevenueBreakdown,
} from "./net-income-types";
import type { ReportSections } from "./rent-roll-types";

const REVENUE_SECTIONS: ReportSections = {
  officeRents: true,
  meetingRoomRevenue: true,
  hotDeskRevenue: true,
  venueRevenue: true,
  additionalServices: true,
  virtualOfficeRevenue: true,
  furnitureRevenue: true,
  vacancyForecast: false,
  revenueVsTarget: false,
  roomByRoom: false,
  tenantByTenant: false,
  monthlySummary: false,
};

function emptyRevenue(): PropertyRevenueBreakdown {
  return { office: 0, meeting: 0, hotDesk: 0, venue: 0, additionalServices: 0, total: 0 };
}

function emptyCosts(): PropertyCostBreakdown {
  return {
    cleaning: 0,
    utilities: 0,
    property_management: 0,
    insurance: 0,
    security: 0,
    it_infrastructure: 0,
    marketing: 0,
    staff: 0,
    one_off: 0,
    total: 0,
  };
}

function monthKeyFromDate(d: string): string {
  const x = new Date(d);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Per property / calendar month revenue (same basis as rent roll revenue sections).
 */
function propertyMonthRevenueMap(
  monthKeys: string[],
  source: RentRollSourceRows,
): Map<string, PropertyRevenueBreakdown> {
  const rrBuild = buildRentRollReport(monthKeys, REVENUE_SECTIONS, null, source);
  const map = new Map<string, PropertyRevenueBreakdown>();

  function key(pid: string, mk: string) {
    return `${pid}|${mk}`;
  }

  function bump(pid: string, mk: string, part: keyof Omit<PropertyRevenueBreakdown, "total">, amt: number) {
    const k = key(pid, mk);
    const cur = map.get(k) ?? emptyRevenue();
    cur[part] += amt;
    cur.total = cur.office + cur.meeting + cur.hotDesk + cur.venue + cur.additionalServices;
    map.set(k, cur);
  }

  for (const o of rrBuild.officeRentRoll) {
    bump(o.propertyId, o.monthKey, "office", o.contractMonthlyRent);
  }

  const { spaces } = source;
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const normalizeSpaceType = (t: string) => {
    if (t === "meeting_room") return "conference_room";
    if (t === "desk") return "hot_desk";
    return t;
  };

  for (const b of source.bookings) {
    if (b.status !== "confirmed") continue;
    const sp = spaceById.get(b.space_id);
    if (!sp) continue;
    const st = normalizeSpaceType(sp.space_type);
    const t = new Date(b.start_at);
    const mk = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!monthKeys.includes(mk)) continue;
    const amt = Number(b.total_price) || 0;
    if (st === "conference_room") bump(b.property_id, mk, "meeting", amt);
    else if (st === "hot_desk") bump(b.property_id, mk, "hotDesk", amt);
    else if (st === "venue") bump(b.property_id, mk, "venue", amt);
  }

  for (const s of source.additionalServices) {
    const d = new Date(s.billing_month);
    const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!monthKeys.includes(mk)) continue;
    bump(s.property_id, mk, "additionalServices", (Number(s.unit_price) || 0) * (Number(s.quantity_used) || 0));
  }

  return map;
}

function costBreakdownFromEntries(
  entries: PropertyCostEntryRow[],
  monthKeys: string[],
  propertyIds: string[],
): Map<string, { costs: PropertyCostBreakdown; scheduled: number; confirmed: number }> {
  const map = new Map<string, { costs: PropertyCostBreakdown; scheduled: number; confirmed: number }>();

  function k(pid: string, mk: string) {
    return `${pid}|${mk}`;
  }

  for (const pid of propertyIds) {
    for (const mk of monthKeys) {
      map.set(k(pid, mk), { costs: emptyCosts(), scheduled: 0, confirmed: 0 });
    }
  }

  for (const e of entries) {
    if (e.status === "cancelled") continue;
    const mk = monthKeyFromDate(e.period_month);
    if (!monthKeys.includes(mk)) continue;
    const keyStr = k(e.property_id, mk);
    if (!map.has(keyStr)) continue;
    const row = map.get(keyStr)!;
    const ct = e.cost_type as keyof Omit<PropertyCostBreakdown, "total">;
    if (ct in row.costs) {
      row.costs[ct] += Number(e.amount) || 0;
    }
    row.costs.total =
      row.costs.cleaning +
      row.costs.utilities +
      row.costs.property_management +
      row.costs.insurance +
      row.costs.security +
      row.costs.it_infrastructure +
      row.costs.marketing +
      row.costs.staff +
      row.costs.one_off;
    if (e.status === "scheduled") row.scheduled += Number(e.amount) || 0;
    if (e.status === "confirmed") row.confirmed += Number(e.amount) || 0;
    map.set(keyStr, row);
  }

  return map;
}

export function buildNetIncomeReport(
  monthKeys: string[],
  source: RentRollSourceRows,
  costEntries: PropertyCostEntryRow[],
): NetIncomeReportModel {
  const properties = source.properties.map((p) => ({
    id: p.id,
    name: p.name ?? "",
    city: p.city ?? null,
  }));
  const propertyIds = properties.map((p) => p.id);
  const revMap = propertyMonthRevenueMap(monthKeys, source);
  const costMap = costBreakdownFromEntries(costEntries, monthKeys, propertyIds);

  const rows: NetIncomeMonthRow[] = [];
  for (const p of properties) {
    for (const mk of monthKeys) {
      const rk = `${p.id}|${mk}`;
      const revenue = revMap.get(rk) ?? emptyRevenue();
      const ce = costMap.get(rk) ?? { costs: emptyCosts(), scheduled: 0, confirmed: 0 };
      const netIncome = revenue.total - ce.costs.total;
      const netMarginPct =
        revenue.total > 0 ? (netIncome / revenue.total) * 100 : revenue.total === 0 && netIncome === 0 ? 0 : null;

      rows.push({
        propertyId: p.id,
        propertyName: p.name,
        monthKey: mk,
        revenue,
        costs: ce.costs,
        netIncome,
        netMarginPct,
        costsScheduled: ce.scheduled,
        costsConfirmed: ce.confirmed,
      });
    }
  }

  const portfolioByMonth = monthKeys.map((mk) => {
    const slice = rows.filter((r) => r.monthKey === mk);
    const revenue = emptyRevenue();
    const costs = emptyCosts();
    for (const r of slice) {
      revenue.office += r.revenue.office;
      revenue.meeting += r.revenue.meeting;
      revenue.hotDesk += r.revenue.hotDesk;
      revenue.venue += r.revenue.venue;
      revenue.additionalServices += r.revenue.additionalServices;
      revenue.total += r.revenue.total;
      costs.cleaning += r.costs.cleaning;
      costs.utilities += r.costs.utilities;
      costs.property_management += r.costs.property_management;
      costs.insurance += r.costs.insurance;
      costs.security += r.costs.security;
      costs.it_infrastructure += r.costs.it_infrastructure;
      costs.marketing += r.costs.marketing;
      costs.staff += r.costs.staff;
      costs.one_off += r.costs.one_off;
      costs.total += r.costs.total;
    }
    const netIncome = revenue.total - costs.total;
    const netMarginPct =
      revenue.total > 0 ? (netIncome / revenue.total) * 100 : revenue.total === 0 && netIncome === 0 ? 0 : null;
    return { monthKey: mk, revenue, costs, netIncome, netMarginPct };
  });

  return {
    generatedAt: new Date().toISOString(),
    startDate: monthKeys[0] ?? "",
    endDate: monthKeys[monthKeys.length - 1] ?? "",
    monthKeys,
    properties,
    rows,
    portfolioByMonth,
  };
}
