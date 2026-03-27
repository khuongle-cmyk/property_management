import { NextResponse } from "next/server";

const CSV = `company_name,business_id,vat_number,company_type,industry_sector,company_size,company_website,billing_street,billing_postal_code,billing_city,billing_email,e_invoice_address,e_invoice_operator_code,contact_first_name,contact_last_name,contact_title,email,phone,direct_phone,source,interested_property,space_type,size_m2,budget_month,move_in_date,notes
Acme Oy,1234567-8,FI12345678,oy,Technology,11-50,https://acme.example,Helsinginkatu 1,00100,Helsinki,billing@acme.example,003712345678,OVT123,Erkki,Esimerkki,Toimitusjohtaja,erkki@acme.example,+358401234567,+358401111111,website,Downtown HQ,office,120,4500,2025-08-01,Needs parking
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
