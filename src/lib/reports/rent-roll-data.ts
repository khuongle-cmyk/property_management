import type { SupabaseClient } from "@supabase/supabase-js";
import type { RentRollSourceRows } from "./rent-roll-builder";

export function monthRangeBoundsIso(monthKeys: string[]): { start: string; end: string } | null {
  if (monthKeys.length === 0) return null;
  const first = monthKeys[0].split("-").map(Number);
  const last = monthKeys[monthKeys.length - 1].split("-").map(Number);
  const start = new Date(Date.UTC(first[0], first[1] - 1, 1)).toISOString();
  const end = new Date(Date.UTC(last[0], last[1], 0, 23, 59, 59, 999)).toISOString();
  return { start, end };
}

/**
 * Loads the same fact rows used by the rent roll report (revenue sources).
 */
export async function loadRentRollSourceRows(
  supabase: SupabaseClient,
  allowedIds: string[],
  monthKeys: string[],
): Promise<{ source: RentRollSourceRows | null; error: string | null }> {
  const bounds = monthRangeBoundsIso(monthKeys);
  if (!bounds) return { source: null, error: "Invalid month range" };

  const { data: properties, error: pErr } = await supabase
    .from("properties")
    .select("id, name, city")
    .in("id", allowedIds)
    .order("name", { ascending: true });
  if (pErr) return { source: null, error: pErr.message };

  const { data: spaces, error: sErr } = await supabase
    .from("bookable_spaces")
    .select("id, property_id, name, room_number, space_type, monthly_rent_eur, hourly_price")
    .in("property_id", allowedIds);
  if (sErr) return { source: null, error: sErr.message };

  const { data: contracts, error: cErr } = await supabase
    .from("room_contracts")
    .select("id, property_id, tenant_id, lead_id, monthly_rent, start_date, end_date, status")
    .in("property_id", allowedIds);
  if (cErr) return { source: null, error: cErr.message };

  const contractIds = (contracts ?? []).map((c: { id: string }) => c.id);
  let contractItems: RentRollSourceRows["contractItems"] = [];
  if (contractIds.length > 0) {
    const { data: items, error: iErr } = await supabase
      .from("room_contract_items")
      .select("contract_id, space_id, monthly_rent, hourly_rate")
      .in("contract_id", contractIds);
    if (iErr) return { source: null, error: iErr.message };
    contractItems = (items ?? []) as RentRollSourceRows["contractItems"];
  }

  const leadIds = [
    ...new Set(
      (contracts ?? [])
        .map((c: { lead_id: string | null }) => c.lead_id)
        .filter(Boolean),
    ),
  ] as string[];
  let leads: RentRollSourceRows["leads"] = [];
  if (leadIds.length > 0) {
    const { data: ld, error: lErr } = await supabase
      .from("leads")
      .select("id, company_name")
      .in("id", leadIds);
    if (lErr) return { source: null, error: lErr.message };
    leads = (ld ?? []) as RentRollSourceRows["leads"];
  }

  const tenantIds = [...new Set((contracts ?? []).map((c: { tenant_id: string }) => c.tenant_id))];
  let tenants: RentRollSourceRows["tenants"] = [];
  if (tenantIds.length > 0) {
    const { data: tn, error: tErr } = await supabase
      .from("tenants")
      .select("id, name")
      .in("id", tenantIds);
    if (tErr) return { source: null, error: tErr.message };
    tenants = (tn ?? []) as RentRollSourceRows["tenants"];
  }

  const firstMonthDay = `${monthKeys[0]}-01`;
  const lastMk = monthKeys[monthKeys.length - 1];
  const lastMonthDay = `${lastMk}-01`;

  const { data: leaseInvoices, error: invErr } = await supabase
    .from("lease_invoices")
    .select("contract_id, property_id, billing_month, base_rent, additional_services_total, total_amount")
    .in("property_id", allowedIds)
    .gte("billing_month", firstMonthDay)
    .lte("billing_month", lastMonthDay);
  if (invErr) return { source: null, error: invErr.message };

  const { data: additionalServices, error: asErr } = await supabase
    .from("additional_services")
    .select("property_id, billing_month, unit_price, quantity_used")
    .in("property_id", allowedIds)
    .gte("billing_month", firstMonthDay)
    .lte("billing_month", lastMonthDay);
  if (asErr) return { source: null, error: asErr.message };

  const { data: bookings, error: bErr } = await supabase
    .from("bookings")
    .select(
      "property_id, space_id, start_at, end_at, status, total_price, booker_type, visitor_name, visitor_email, booker_user_id",
    )
    .in("property_id", allowedIds)
    .lte("start_at", bounds.end)
    .gte("end_at", bounds.start);
  if (bErr) return { source: null, error: bErr.message };

  const { data: historicalRevenue, error: hErr } = await supabase
    .from("historical_revenue")
    .select(
      "property_id, year, month, office_rent_revenue, meeting_room_revenue, hot_desk_revenue, venue_revenue, additional_services_revenue, virtual_office_revenue, furniture_revenue, total_revenue",
    )
    .in("property_id", allowedIds)
    .gte("year", Number(monthKeys[0].slice(0, 4)))
    .lte("year", Number(monthKeys[monthKeys.length - 1].slice(0, 4)));
  if (hErr && hErr.code !== "42P01") return { source: null, error: hErr.message };

  const source: RentRollSourceRows = {
    properties: (properties ?? []) as RentRollSourceRows["properties"],
    spaces: (spaces ?? []) as RentRollSourceRows["spaces"],
    contracts: (contracts ?? []) as RentRollSourceRows["contracts"],
    contractItems,
    leads,
    tenants,
    leaseInvoices: (leaseInvoices ?? []) as RentRollSourceRows["leaseInvoices"],
    additionalServices: (additionalServices ?? []) as RentRollSourceRows["additionalServices"],
    bookings: (bookings ?? []) as RentRollSourceRows["bookings"],
    historicalRevenue: ((historicalRevenue ?? []) as RentRollSourceRows["historicalRevenue"]) ?? [],
  };

  return { source, error: null };
}
