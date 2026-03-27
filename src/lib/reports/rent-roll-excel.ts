import * as XLSX from "xlsx";
import type { RentRollReportModel } from "./rent-roll-types";
import { spaceTypeLabel } from "@/lib/rooms/labels";

function sheetFromAoA(rows: (string | number | null)[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

export function downloadRentRollExcel(report: RentRollReportModel, baseName: string): void {
  const wb = XLSX.utils.book_new();
  const safeName = baseName.replace(/[^\w\-]+/g, "_").slice(0, 80);

  const summaryHead: (string | number | null)[][] = [
    ["Month", "Office (contract)", "Meeting bookings", "Hot desk", "Venue", "Additional services", "Total"],
    ...report.monthlySummary.map((r) => [
      r.monthKey,
      r.officeContractRent,
      r.meetingRoomBookings,
      r.hotDeskBookings,
      r.venueBookings,
      r.additionalServices,
      r.total,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromAoA(summaryHead), "Monthly summary");

  if (report.sections.officeRents && report.officeRentRoll.length) {
    const head: (string | number | null)[][] = [
      [
        "Month",
        "Property",
        "Room #",
        "Space",
        "Type",
        "Lessee",
        "Contract start",
        "Contract end",
        "Status",
        "Contract rent",
        "Invoiced base",
        "Invoiced add-ons",
        "Invoiced total",
      ],
      ...report.officeRentRoll.map((o) => [
        o.monthKey,
        o.propertyName,
        o.roomNumber,
        o.spaceName,
        o.spaceType,
        o.lessee,
        o.contractStart,
        o.contractEnd,
        o.contractStatus,
        o.contractMonthlyRent,
        o.invoicedBaseRent,
        o.invoicedAdditionalServices,
        o.invoicedTotal,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, sheetFromAoA(head), "Office rent roll");
  }

  if (report.sections.vacancyForecast && report.vacancyForecast.length) {
    const head: (string | number | null)[][] = [
      ["Month", "Property", "Room #", "Space", "Type", "List monthly", "List hourly", "Note"],
      ...report.vacancyForecast.map((v) => [
        v.monthKey,
        v.propertyName,
        v.roomNumber,
        v.spaceName,
        v.spaceType,
        v.listMonthlyRent,
        v.listHourly,
        v.note,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, sheetFromAoA(head), "Vacancy forecast");
  }

  if (report.sections.tenantByTenant && report.tenantByTenant.length) {
    const head: (string | number | null)[][] = [
      ["Name / bucket", "Office (contract)", "Bookings", "Additional services", "Total"],
      ...report.tenantByTenant.map((t) => [
        t.displayName,
        t.officeContractRent,
        t.bookingRevenue,
        t.additionalServices,
        t.total,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, sheetFromAoA(head), "Tenant breakdown");
  }

  if (report.sections.revenueVsTarget && report.revenueVsTarget.length) {
    const head: (string | number | null)[][] = [
      ["Month", "Actual", "Target", "Variance", "Variance %"],
      ...report.revenueVsTarget.map((r) => [
        r.monthKey,
        r.total,
        r.target,
        r.variance,
        r.variancePct,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, sheetFromAoA(head), "Revenue vs target");
  }

  if (report.sections.roomByRoom && report.roomByRoom.length) {
    const head: (string | number | null)[][] = [
      ["Property", "Room #", "Space", "Type", "Month", "Amount", "Basis"],
    ];
    for (const row of report.roomByRoom) {
      for (const cell of row.months) {
        head.push([
          row.propertyName,
          row.roomNumber,
          row.spaceName,
          spaceTypeLabel(row.spaceType),
          cell.monthKey,
          cell.amount,
          cell.basis,
        ]);
      }
    }
    XLSX.utils.book_append_sheet(wb, sheetFromAoA(head), "Room by room");
  }

  XLSX.writeFile(wb, `${safeName || "rent_roll_report"}.xlsx`);
}
