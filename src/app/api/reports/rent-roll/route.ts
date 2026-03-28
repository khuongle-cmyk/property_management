import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildRentRollReport, eachMonthKeyInclusive } from "@/lib/reports/rent-roll-builder";
import { loadRentRollSourceRows } from "@/lib/reports/rent-roll-data";
import { normalizeMemberships, resolveAllowedPropertyIds } from "@/lib/reports/report-access";
import type { RentRollRequestBody, ReportSections } from "@/lib/reports/rent-roll-types";

function coerceSections(raw: unknown): ReportSections {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    officeRents: !!d.officeRents,
    meetingRoomRevenue: !!d.meetingRoomRevenue,
    hotDeskRevenue: !!d.hotDeskRevenue,
    venueRevenue: !!d.venueRevenue,
    additionalServices: !!d.additionalServices,
    virtualOfficeRevenue: !!d.virtualOfficeRevenue,
    furnitureRevenue: !!d.furnitureRevenue,
    vacancyForecast: !!d.vacancyForecast,
    revenueVsTarget: !!d.revenueVsTarget,
    roomByRoom: !!d.roomByRoom,
    tenantByTenant: !!d.tenantByTenant,
    monthlySummary: !!d.monthlySummary,
  };
}

export async function POST(req: Request) {
  let body: RentRollRequestBody;
  try {
    body = (await req.json()) as RentRollRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const startDate = (body.startDate ?? "").trim().slice(0, 10);
  const endDate = (body.endDate ?? "").trim().slice(0, 10);
  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate are required (YYYY-MM-DD)" }, { status: 400 });
  }

  const monthKeys = eachMonthKeyInclusive(startDate, endDate);
  if (monthKeys.length === 0) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }
  if (monthKeys.length > 120) {
    return NextResponse.json({ error: "Range too large (max 120 months)" }, { status: 400 });
  }

  const sections = coerceSections(body.sections);
  const revenueTarget =
    body.revenueTargetMonthly != null && !Number.isNaN(Number(body.revenueTargetMonthly))
      ? Number(body.revenueTargetMonthly)
      : null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membershipRows, error: mErr } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id);

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const { isSuperAdmin, canRunReports, scopedTenantIds } = normalizeMemberships(
    (membershipRows ?? []) as { tenant_id: string | null; role: string | null }[],
  );
  if (!canRunReports) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requestedIds =
    Array.isArray(body.propertyIds) && body.propertyIds.length > 0 ? body.propertyIds : null;

  const { allowedIds, error: scopeErr } = await resolveAllowedPropertyIds(
    supabase,
    isSuperAdmin,
    scopedTenantIds,
    requestedIds,
  );
  if (scopeErr || allowedIds.length === 0) {
    return NextResponse.json({ error: scopeErr ?? "No properties" }, { status: 400 });
  }

  const { source, error: loadErr } = await loadRentRollSourceRows(supabase, allowedIds, monthKeys);
  if (loadErr || !source) {
    return NextResponse.json({ error: loadErr ?? "Failed to load data" }, { status: 500 });
  }

  const report = buildRentRollReport(monthKeys, sections, revenueTarget, source);
  return NextResponse.json(report);
}
