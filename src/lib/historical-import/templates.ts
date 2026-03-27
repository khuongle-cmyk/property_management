import type { ImportType } from "./types";

const templates: Record<ImportType, string> = {
  revenue:
    "property,year,month,office_rent_revenue,meeting_room_revenue,hot_desk_revenue,venue_revenue,virtual_office_revenue,furniture_revenue,additional_services_revenue,total_revenue\nErottaja2,2024,1,25000,3200,1800,2200,1200,650,900,34950\n",
  costs:
    "property,date,cost_type,description,amount_ex_vat,vat_amount,total_amount,supplier,invoice_number\nErottaja2,2024-01-10,utilities,Electricity January,2400,612,3012,Helen Oy,EL-2024-001\n",
  invoices:
    "invoice_number,invoice_date,due_date,client_tenant,property,amount_ex_vat,vat_amount,total_amount,status,payment_date\nINV-2024-001,2024-01-31,2024-02-14,Acme Oy,Erottaja2,1500,382.5,1882.5,paid,2024-02-10\n",
  occupancy:
    "property,year,month,total_rooms,occupied_rooms,occupancy_pct,revenue_per_m2\nErottaja2,2024,1,25,22,88,47.5\n",
};

export function templateCsv(importType: ImportType): string {
  return templates[importType];
}
