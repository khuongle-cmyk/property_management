import { NextResponse } from "next/server";

const CSV_HEADER =
  "date,cost_type,description,amount,supplier,invoice_number,recurring,recurring_frequency,notes\n";

const SAMPLE =
  '2025-01-15,cleaning,"Monthly cleaning",250.00,"ACME Clean",,no,,\n2025-01-01,utilities,"Electricity January",420.50,Vattenfall,INV-001,no,,\n';

export async function GET() {
  const body = CSV_HEADER + SAMPLE;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="property_costs_import_template.csv"',
    },
  });
}
