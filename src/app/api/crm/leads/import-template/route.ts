import { NextResponse } from "next/server";

const CSV = `company_name,company_registration,vat_number,company_type,company_size,industry,website,contact_first_name,contact_last_name,contact_title,contact_phone_direct,email,phone,source,interested_property,space_type,size_m2,budget_month,move_in_date,billing_address,billing_postal_code,billing_city,billing_email,e_invoice_address,e_invoice_operator,notes
Acme Oy,1234567-8,FI12345678,oy,11-50,Technology,https://acme.example,Erkki,Esimerkki,Toimitusjohtaja,+358401111111,erkki@acme.example,+358401234567,website,Downtown HQ,office,120,4500,2025-08-01,Helsinginkatu 1,00100,Helsinki,billing@acme.example,003712345678,OVT123,Needs parking
`;

export async function GET() {
  return new NextResponse(CSV, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="crm_leads_import_template.csv"',
    },
  });
}
