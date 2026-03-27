import type {
  OfficeRentRow,
  RentRollReportModel,
  ReportSections,
  RoomByRoomRow,
  RoomMonthCell,
  TenantBreakdownRow,
  VacancyRow,
} from "./rent-roll-types";

export function parseISODateUtc(s: string): Date {
  return new Date(`${s.trim().slice(0, 10)}T00:00:00.000Z`);
}

export function eachMonthKeyInclusive(startStr: string, endStr: string): string[] {
  const s = parseISODateUtc(startStr);
  const e = parseISODateUtc(endStr);
  if (e < s) return [];
  const out: string[] = [];
  let y = s.getUTCFullYear();
  let m = s.getUTCMonth();
  const endY = e.getUTCFullYear();
  const endM = e.getUTCMonth();
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return out;
}

function monthBoundsUtc(monthKey: string): { start: number; end: number } {
  const [Y, M] = monthKey.split("-").map(Number);
  const start = Date.UTC(Y, M - 1, 1);
  const end = Date.UTC(Y, M, 0, 23, 59, 59, 999);
  return { start, end };
}

export function contractActiveInMonth(
  startDate: string,
  endDate: string | null,
  status: string,
  monthKey: string,
): boolean {
  if (status !== "active") return false;
  const { start: ms, end: me } = monthBoundsUtc(monthKey);
  const sd = parseISODateUtc(startDate).getTime();
  const ed = endDate ? parseISODateUtc(endDate).getTime() : Number.POSITIVE_INFINITY;
  if (sd > me) return false;
  if (ed < ms) return false;
  return true;
}

export function normalizeSpaceType(t: string): string {
  if (t === "meeting_room") return "conference_room";
  if (t === "desk") return "hot_desk";
  return t;
}

type Property = { id: string; name: string | null; city: string | null };
type Space = {
  id: string;
  property_id: string;
  name: string;
  room_number: string | null;
  space_type: string;
  monthly_rent_eur: number | null;
  hourly_price: number | null;
};
type Contract = {
  id: string;
  property_id: string;
  tenant_id: string;
  lead_id: string | null;
  monthly_rent: number;
  start_date: string;
  end_date: string | null;
  status: string;
};
type ContractItem = {
  contract_id: string;
  space_id: string;
  monthly_rent: number;
  hourly_rate: number | null;
};
type Lead = { id: string; company_name: string | null };
type Tenant = { id: string; name: string | null };
type LeaseInvoice = {
  contract_id: string;
  property_id: string;
  billing_month: string;
  base_rent: number;
  additional_services_total: number;
  total_amount: number;
};
type AdditionalService = {
  property_id: string;
  billing_month: string;
  unit_price: number;
  quantity_used: number;
};
type Booking = {
  property_id: string;
  space_id: string;
  start_at: string;
  end_at: string;
  status: string;
  total_price: number;
  booker_type: string;
  visitor_name: string | null;
  visitor_email: string | null;
  booker_user_id: string | null;
};
type HistoricalRevenue = {
  property_id: string;
  year: number;
  month: number;
  office_rent_revenue: number;
  meeting_room_revenue: number;
  hot_desk_revenue: number;
  venue_revenue: number;
  additional_services_revenue: number;
  virtual_office_revenue: number;
  furniture_revenue: number;
  total_revenue: number;
};

export type RentRollSourceRows = {
  properties: Property[];
  spaces: Space[];
  contracts: Contract[];
  contractItems: ContractItem[];
  leads: Lead[];
  tenants: Tenant[];
  leaseInvoices: LeaseInvoice[];
  additionalServices: AdditionalService[];
  bookings: Booking[];
  historicalRevenue: HistoricalRevenue[];
};

function invoicedKey(contractId: string, monthKey: string): string {
  return `${contractId}|${monthKey}`;
}

function lesseeName(contract: Contract, leadById: Map<string, Lead>, tenantById: Map<string, Tenant>): string {
  if (contract.lead_id) {
    const l = leadById.get(contract.lead_id);
    if (l?.company_name) return l.company_name;
  }
  return tenantById.get(contract.tenant_id)?.name ?? "(unknown)";
}

function bookingAttributionKey(b: Booking): string {
  if (b.booker_type === "visitor") {
    const em = (b.visitor_email ?? "").trim();
    const nm = (b.visitor_name ?? "").trim();
    return em ? `visitor:${em}` : nm ? `visitor:${nm}` : "visitor:unknown";
  }
  return b.booker_user_id ? `user:${b.booker_user_id}` : "registered:unknown";
}

function bookingDisplayName(b: Booking): string {
  if (b.booker_type === "visitor") {
    const nm = (b.visitor_name ?? "").trim();
    const em = (b.visitor_email ?? "").trim();
    if (nm && em) return `${nm} (${em})`;
    return nm || em || "Visitor";
  }
  return b.booker_user_id ? `User ${b.booker_user_id.slice(0, 8)}…` : "Registered booker";
}

export function buildRentRollReport(
  monthKeys: string[],
  sections: ReportSections,
  revenueTargetMonthly: number | null,
  rows: RentRollSourceRows,
): RentRollReportModel {
  const propById = new Map(rows.properties.map((p) => [p.id, p]));
  const spaceById = new Map(rows.spaces.map((s) => [s.id, s]));
  const itemsByContract = new Map<string, ContractItem[]>();
  for (const it of rows.contractItems) {
    const arr = itemsByContract.get(it.contract_id) ?? [];
    arr.push(it);
    itemsByContract.set(it.contract_id, arr);
  }
  const leadById = new Map(rows.leads.map((l) => [l.id, l]));
  const tenantById = new Map(rows.tenants.map((t) => [t.id, t]));

  const invoiceByKey = new Map<string, LeaseInvoice>();
  for (const inv of rows.leaseInvoices) {
    const d = new Date(inv.billing_month);
    const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    invoiceByKey.set(invoicedKey(inv.contract_id, mk), inv);
  }

  const contractsBySpaceMonth = new Map<string, Contract[]>();
  for (const c of rows.contracts) {
    for (const m of monthKeys) {
      if (!contractActiveInMonth(c.start_date, c.end_date, c.status, m)) continue;
      const items = itemsByContract.get(c.id) ?? [];
      for (const it of items) {
        const k = `${it.space_id}|${m}`;
        const arr = contractsBySpaceMonth.get(k) ?? [];
        if (!arr.some((x) => x.id === c.id)) arr.push(c);
        contractsBySpaceMonth.set(k, arr);
      }
    }
  }

  const officeRentRoll: OfficeRentRow[] = [];
  const vacancyForecast: VacancyRow[] = [];

  for (const m of monthKeys) {
    for (const s of rows.spaces) {
      const st = normalizeSpaceType(s.space_type);
      const p = propById.get(s.property_id);
      if (!p) continue;

      const key = `${s.id}|${m}`;
      const matching = contractsBySpaceMonth.get(key) ?? [];
      const contract = matching[0];

      if (st === "office" && sections.officeRents) {
        if (contract) {
          const it = (itemsByContract.get(contract.id) ?? []).find((i) => i.space_id === s.id);
          const rent = it ? Number(it.monthly_rent) || 0 : 0;
          const inv = invoiceByKey.get(invoicedKey(contract.id, m));
          officeRentRoll.push({
            monthKey: m,
            propertyId: p.id,
            propertyName: p.name ?? "",
            spaceId: s.id,
            roomNumber: s.room_number,
            spaceName: s.name,
            spaceType: st,
            lessee: lesseeName(contract, leadById, tenantById),
            contractStart: contract.start_date,
            contractEnd: contract.end_date,
            contractStatus: contract.status,
            contractMonthlyRent: rent,
            invoicedBaseRent: inv ? Number(inv.base_rent) : null,
            invoicedAdditionalServices: inv ? Number(inv.additional_services_total) : null,
            invoicedTotal: inv ? Number(inv.total_amount) : null,
          });
        } else if (sections.vacancyForecast) {
          vacancyForecast.push({
            monthKey: m,
            propertyId: p.id,
            propertyName: p.name ?? "",
            spaceId: s.id,
            roomNumber: s.room_number,
            spaceName: s.name,
            spaceType: st,
            listMonthlyRent: s.monthly_rent_eur != null ? Number(s.monthly_rent_eur) : null,
            listHourly: s.hourly_price != null ? Number(s.hourly_price) : null,
            note: "No active lease covering this month; listing rent is indicative.",
          });
        }
      }

    }
  }

  const meeting: Record<string, number> = {};
  const hotDesk: Record<string, number> = {};
  const venue: Record<string, number> = {};
  const addl: Record<string, number> = {};
  const virtualOffice: Record<string, number> = {};
  const furniture: Record<string, number> = {};

  for (const m of monthKeys) {
    meeting[m] = 0;
    hotDesk[m] = 0;
    venue[m] = 0;
    addl[m] = 0;
    virtualOffice[m] = 0;
    furniture[m] = 0;
  }

  for (const b of rows.bookings) {
    if (b.status !== "confirmed") continue;
    const sp = spaceById.get(b.space_id);
    if (!sp) continue;
    const st = normalizeSpaceType(sp.space_type);
    const t = new Date(b.start_at);
    const mk = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!monthKeys.includes(mk)) continue;
    const amt = Number(b.total_price) || 0;
    if (st === "conference_room" && sections.meetingRoomRevenue) meeting[mk] += amt;
    else if (st === "hot_desk" && sections.hotDeskRevenue) hotDesk[mk] += amt;
    else if (st === "venue" && sections.venueRevenue) venue[mk] += amt;
  }

  if (sections.additionalServices) {
    for (const s of rows.additionalServices) {
      const d = new Date(s.billing_month);
      const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      if (!monthKeys.includes(mk)) continue;
      addl[mk] += (Number(s.unit_price) || 0) * (Number(s.quantity_used) || 0);
    }
  }

  const officeByMonth: Record<string, number> = {};
  for (const m of monthKeys) officeByMonth[m] = 0;
  if (sections.officeRents) {
    for (const r of officeRentRoll) {
      officeByMonth[r.monthKey] = (officeByMonth[r.monthKey] ?? 0) + r.contractMonthlyRent;
    }
  }
  // Historical imports (monthly totals), primarily for older baseline periods.
  for (const hr of rows.historicalRevenue) {
    const mk = `${hr.year}-${String(hr.month).padStart(2, "0")}`;
    if (!monthKeys.includes(mk)) continue;
    if (sections.officeRents) officeByMonth[mk] = (officeByMonth[mk] ?? 0) + (Number(hr.office_rent_revenue) || 0);
    if (sections.meetingRoomRevenue) meeting[mk] = (meeting[mk] ?? 0) + (Number(hr.meeting_room_revenue) || 0);
    if (sections.hotDeskRevenue) hotDesk[mk] = (hotDesk[mk] ?? 0) + (Number(hr.hot_desk_revenue) || 0);
    if (sections.venueRevenue) venue[mk] = (venue[mk] ?? 0) + (Number(hr.venue_revenue) || 0);
    if (sections.additionalServices) addl[mk] = (addl[mk] ?? 0) + (Number(hr.additional_services_revenue) || 0);
    if (sections.virtualOfficeRevenue) virtualOffice[mk] = (virtualOffice[mk] ?? 0) + (Number(hr.virtual_office_revenue) || 0);
    if (sections.furnitureRevenue) furniture[mk] = (furniture[mk] ?? 0) + (Number(hr.furniture_revenue) || 0);
  }

  const monthlySummary = monthKeys.map((mk) => {
    const officeContractRent = sections.officeRents ? officeByMonth[mk] ?? 0 : 0;
    const meetingRoomBookings = sections.meetingRoomRevenue ? meeting[mk] ?? 0 : 0;
    const hotDeskBookings = sections.hotDeskRevenue ? hotDesk[mk] ?? 0 : 0;
    const venueBookings = sections.venueRevenue ? venue[mk] ?? 0 : 0;
    const additionalServices = sections.additionalServices ? addl[mk] ?? 0 : 0;
    const virtualOfficeRevenue = sections.virtualOfficeRevenue ? virtualOffice[mk] ?? 0 : 0;
    const furnitureRevenue = sections.furnitureRevenue ? furniture[mk] ?? 0 : 0;
    const total =
      officeContractRent + meetingRoomBookings + hotDeskBookings + venueBookings + additionalServices + virtualOfficeRevenue + furnitureRevenue;
    return {
      monthKey: mk,
      officeContractRent,
      meetingRoomBookings,
      hotDeskBookings,
      venueBookings,
      additionalServices,
      virtualOfficeRevenue,
      furnitureRevenue,
      total,
    };
  });

  const revenueVsTarget =
    sections.revenueVsTarget && revenueTargetMonthly != null && revenueTargetMonthly > 0
      ? monthlySummary.map((row) => {
          const variance = row.total - revenueTargetMonthly;
          const variancePct =
            revenueTargetMonthly !== 0 ? (variance / revenueTargetMonthly) * 100 : null;
          return {
            monthKey: row.monthKey,
            total: row.total,
            target: revenueTargetMonthly,
            variance,
            variancePct,
          };
        })
      : [];

  const tenantMap = new Map<string, TenantBreakdownRow>();

  function bumpTenant(key: string, name: string, field: keyof Pick<TenantBreakdownRow, "officeContractRent" | "bookingRevenue" | "additionalServices">, amt: number) {
    const cur = tenantMap.get(key) ?? {
      bucketKey: key,
      displayName: name,
      officeContractRent: 0,
      bookingRevenue: 0,
      additionalServices: 0,
      total: 0,
    };
    cur[field] += amt;
    cur.total = cur.officeContractRent + cur.bookingRevenue + cur.additionalServices;
    tenantMap.set(key, cur);
  }

  if (sections.tenantByTenant) {
    if (sections.officeRents) {
      for (const r of officeRentRoll) {
        const key = `lease:${r.lessee}`;
        bumpTenant(key, r.lessee, "officeContractRent", r.contractMonthlyRent);
      }
    }

    if (sections.meetingRoomRevenue || sections.hotDeskRevenue || sections.venueRevenue) {
      for (const b of rows.bookings) {
        if (b.status !== "confirmed") continue;
        const sp = spaceById.get(b.space_id);
        if (!sp) continue;
        const st = normalizeSpaceType(sp.space_type);
        const t = new Date(b.start_at);
        const mk = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
        if (!monthKeys.includes(mk)) continue;
        const amt = Number(b.total_price) || 0;
        const include =
          (st === "conference_room" && sections.meetingRoomRevenue) ||
          (st === "hot_desk" && sections.hotDeskRevenue) ||
          (st === "venue" && sections.venueRevenue);
        if (!include) continue;
        const bk = bookingAttributionKey(b);
        bumpTenant(`b:${bk}`, bookingDisplayName(b), "bookingRevenue", amt);
      }
    }

    if (sections.additionalServices) {
      const svcTotal = monthKeys.reduce((s, mk) => s + (addl[mk] ?? 0), 0);
      if (svcTotal > 0) {
        bumpTenant("__additional__", "Additional services (aggregated)", "additionalServices", svcTotal);
      }
    }
  }

  const tenantByTenant = sections.tenantByTenant
    ? [...tenantMap.values()].sort((a, b) => b.total - a.total)
    : [];

  const roomByRoom: RoomByRoomRow[] = [];
  if (sections.roomByRoom) {
    for (const s of rows.spaces) {
      const p = propById.get(s.property_id);
      if (!p) continue;
      const st = normalizeSpaceType(s.space_type);
      const months: RoomMonthCell[] = [];
      for (const m of monthKeys) {
        let amount = 0;
        let basis = "—";
        const key = `${s.id}|${m}`;
        const matching = contractsBySpaceMonth.get(key) ?? [];
        const contract = matching[0];
        if (contract && st === "office") {
          const it = (itemsByContract.get(contract.id) ?? []).find((i) => i.space_id === s.id);
          if (it) {
            amount = Number(it.monthly_rent) || 0;
            basis = "Lease";
          }
        }
        let bookSum = 0;
        const countBooking =
          (st === "conference_room" && sections.meetingRoomRevenue) ||
          (st === "hot_desk" && sections.hotDeskRevenue) ||
          (st === "venue" && sections.venueRevenue);
        if (countBooking) {
          for (const b of rows.bookings) {
            if (b.space_id !== s.id || b.status !== "confirmed") continue;
            const t = new Date(b.start_at);
            const mk = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
            if (mk !== m) continue;
            bookSum += Number(b.total_price) || 0;
          }
        }
        if (bookSum > 0) {
          amount += bookSum;
          basis = basis === "—" ? "Bookings" : `${basis} + bookings`;
        }
        months.push({ monthKey: m, amount, basis });
      }
      roomByRoom.push({
        propertyId: p.id,
        propertyName: p.name ?? "",
        spaceId: s.id,
        roomNumber: s.room_number,
        spaceName: s.name,
        spaceType: st,
        months,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    startDate: monthKeys[0] ?? "",
    endDate: monthKeys[monthKeys.length - 1] ?? "",
    monthKeys,
    sections,
    revenueTargetMonthly,
    properties: rows.properties.map((p) => ({
      id: p.id,
      name: p.name ?? "",
      city: p.city ?? null,
    })),
    officeRentRoll: sections.officeRents ? officeRentRoll : [],
    revenueByMonth: {
      meeting: sections.meetingRoomRevenue ? meeting : {},
      hotDesk: sections.hotDeskRevenue ? hotDesk : {},
      venue: sections.venueRevenue ? venue : {},
      additionalServices: sections.additionalServices ? addl : {},
      virtualOffice: sections.virtualOfficeRevenue ? virtualOffice : {},
      furniture: sections.furnitureRevenue ? furniture : {},
    },
    monthlySummary,
    vacancyForecast: sections.vacancyForecast ? vacancyForecast : [],
    revenueVsTarget,
    roomByRoom,
    tenantByTenant,
  };
}