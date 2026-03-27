import type { RentRollReportModel } from "./rent-roll-types";

function e(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function rentRollReportToEmailHtml(report: RentRollReportModel): string {
  const title = `Rent roll & revenue — ${report.properties.map((p) => e(p.name)).join(", ") || "Portfolio"}`;
  const monthRows = report.monthlySummary
    .map(
      (r) =>
        `<tr><td>${e(r.monthKey)}</td><td style="text-align:right">${fmt(r.officeContractRent)}</td><td style="text-align:right">${fmt(r.meetingRoomBookings)}</td><td style="text-align:right">${fmt(r.hotDeskBookings)}</td><td style="text-align:right">${fmt(r.venueBookings)}</td><td style="text-align:right">${fmt(r.virtualOfficeRevenue)}</td><td style="text-align:right">${fmt(r.furnitureRevenue)}</td><td style="text-align:right">${fmt(r.additionalServices)}</td><td style="text-align:right"><strong>${fmt(r.total)}</strong></td></tr>`,
    )
    .join("");

  const officeSample = report.officeRentRoll
    .slice(0, 25)
    .map(
      (o) =>
        `<tr><td>${e(o.monthKey)}</td><td>${e(o.propertyName)}</td><td>${e(o.roomNumber ?? "—")}</td><td>${e(o.spaceName)}</td><td>${e(o.lessee)}</td><td style="text-align:right">${fmt(o.contractMonthlyRent)}</td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;line-height:1.4;color:#111">
<p style="color:#555;font-size:14px">Generated ${e(report.generatedAt)} · Range ${e(report.startDate)} → ${e(report.endDate)}</p>
<h2 style="margin:16px 0 8px">Monthly summary</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">
<thead><tr><th>Month</th><th>Office (contract)</th><th>Meeting</th><th>Hot desk</th><th>Venue</th><th>Virtual office</th><th>Furniture</th><th>Add-on services</th><th>Total</th></tr></thead>
<tbody>${monthRows}</tbody>
</table>
${
  report.officeRentRoll.length
    ? `<h2 style="margin:24px 0 8px">Office rent roll (first 25 rows)</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">
<thead><tr><th>Month</th><th>Property</th><th>Room #</th><th>Space</th><th>Lessee</th><th>Rent</th></tr></thead>
<tbody>${officeSample}</tbody>
</table>`
    : ""
}
<p style="margin-top:24px;font-size:12px;color:#666">Open the report builder in the app for the full PDF/Excel export.</p>
</body></html>`;
}
