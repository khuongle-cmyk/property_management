import React from "react";
import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildRentRollReport, eachMonthKeyInclusive } from "@/lib/reports/rent-roll-builder";
import { loadRentRollSourceRows } from "@/lib/reports/rent-roll-data";
import { buildNetIncomeReport } from "@/lib/reports/net-income-builder";
import type { PropertyCostEntryRow } from "@/lib/reports/net-income-types";
import { buildProfessionalNetIncomePack } from "@/lib/reports/professional-net-income-pack";
import { buildProfessionalRentRollPack } from "@/lib/reports/professional-rent-roll-pack";
import { normalizeMemberships, resolveAllowedPropertyIds } from "@/lib/reports/report-access";
import { loadReportExportContext } from "@/lib/reports/report-export-context";
import type { RentRollRequestBody, ReportSections } from "@/lib/reports/rent-roll-types";
import { NetIncomeProfessionalDocument } from "@/lib/reports/pdf/net-income-document";
import { RentRollProfessionalDocument } from "@/lib/reports/pdf/rent-roll-document";

function coerceSections(raw: unknown): ReportSections {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    officeRents: !!d.officeRents,
    meetingRoomRevenue: !!d.meetingRoomRevenue,
    hotDeskRevenue: !!d.hotDeskRevenue,
    venueRevenue: !!d.venueRevenue,
    additionalServices: !!d.additionalServices,
    vacancyForecast: !!d.vacancyForecast,
    revenueVsTarget: !!d.revenueVsTarget,
    roomByRoom: !!d.roomByRoom,
    tenantByTenant: !!d.tenantByTenant,
    monthlySummary: !!d.monthlySummary,
  };
}

type Body =
  | ({ kind: "rent-roll" } & RentRollRequestBody)
  | {
      kind: "net-income";
      propertyIds?: string[] | null;
      startDate?: string;
      endDate?: string;
    };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
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
  if (!canRunReports) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const filenameBase =
    body.kind === "rent-roll"
      ? `rent_roll_professional_${Date.now()}.pdf`
      : `net_income_professional_${Date.now()}.pdf`;

  if (body.kind === "rent-roll") {
    const startDate = (body.startDate ?? "").trim().slice(0, 10);
    const endDate = (body.endDate ?? "").trim().slice(0, 10);
    if (!startDate || !endDate) {
      return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 });
    }
    const monthKeys = eachMonthKeyInclusive(startDate, endDate);
    if (monthKeys.length === 0 || monthKeys.length > 120) {
      return NextResponse.json({ error: "Invalid range" }, { status: 400 });
    }

    const requestedIds = Array.isArray(body.propertyIds) && body.propertyIds.length > 0 ? body.propertyIds : null;
    const { allowedIds, error: scopeErr } = await resolveAllowedPropertyIds(
      supabase,
      isSuperAdmin,
      scopedTenantIds,
      requestedIds,
    );
    if (scopeErr || !allowedIds.length) {
      return NextResponse.json({ error: scopeErr ?? "No properties" }, { status: 400 });
    }

    const exportCtx = await loadReportExportContext(supabase, allowedIds, user.id);
    const { source, error: loadErr } = await loadRentRollSourceRows(supabase, allowedIds, monthKeys);
    if (loadErr || !source) return NextResponse.json({ error: loadErr ?? "Load failed" }, { status: 500 });

    const sections = coerceSections(body.sections);
    const revenueTarget =
      body.revenueTargetMonthly != null && !Number.isNaN(Number(body.revenueTargetMonthly))
        ? Number(body.revenueTargetMonthly)
        : null;
    const report = buildRentRollReport(monthKeys, sections, revenueTarget, source);
    const pack = buildProfessionalRentRollPack(report, exportCtx);

    const buffer = await renderToBuffer(<RentRollProfessionalDocument report={report} pack={pack} />);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filenameBase}"`,
      },
    });
  }

  const startDate = (body.startDate ?? "").trim().slice(0, 10);
  const endDate = (body.endDate ?? "").trim().slice(0, 10);
  if (!startDate || !endDate) return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 });
  const monthKeys = eachMonthKeyInclusive(startDate, endDate);
  if (monthKeys.length === 0 || monthKeys.length > 120) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }

  const requestedIds = Array.isArray(body.propertyIds) && body.propertyIds.length > 0 ? body.propertyIds : null;
  const { allowedIds, error: scopeErr } = await resolveAllowedPropertyIds(
    supabase,
    isSuperAdmin,
    scopedTenantIds,
    requestedIds,
  );
  if (scopeErr || !allowedIds.length) return NextResponse.json({ error: scopeErr ?? "No properties" }, { status: 400 });

  const exportCtx = await loadReportExportContext(supabase, allowedIds, user.id);
  const { source, error: loadErr } = await loadRentRollSourceRows(supabase, allowedIds, monthKeys);
  if (loadErr || !source) return NextResponse.json({ error: loadErr ?? "Load failed" }, { status: 500 });

  const firstMonthDay = `${monthKeys[0]}-01`;
  const lastMk = monthKeys[monthKeys.length - 1];
  const lastMonthDay = `${lastMk}-01`;

  const { data: costRows, error: cErr } = await supabase
    .from("property_cost_entries")
    .select(
      "id, property_id, cost_type, description, amount, cost_date, period_month, supplier_name, invoice_number, notes, status, source, recurring_template_id",
    )
    .in("property_id", allowedIds)
    .gte("period_month", firstMonthDay)
    .lte("period_month", lastMonthDay);

  if (cErr) {
    return NextResponse.json(
      {
        error:
          cErr.message.includes("property_cost_entries") || cErr.code === "42P01"
            ? "Cost tables missing — run sql/property_costs_net_income.sql"
            : cErr.message,
      },
      { status: 503 },
    );
  }

  const entries = (costRows ?? []) as PropertyCostEntryRow[];
  const report = buildNetIncomeReport(monthKeys, source, entries);
  const pack = buildProfessionalNetIncomePack(report, exportCtx);

  const buffer = await renderToBuffer(<NetIncomeProfessionalDocument report={report} pack={pack} />);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filenameBase}"`,
    },
  });
}
