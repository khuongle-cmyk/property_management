import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SPACE_TYPES } from "@/lib/rooms/labels";

const COLUMN_ORDER = [
  "tenant_name",
  "property_name",
  "room_name",
  "space_type",
  "floor",
  "room_number",
  "capacity",
  "size_m2",
  "hourly_price",
  "monthly_rent",
  "requires_approval",
  "space_status",
  "amenities",
  "notes",
] as const;

const STATUS_VALUES = ["available", "occupied", "under_maintenance"] as const;
const REQUIRES_APPROVAL_VALUES = ["yes", "no"] as const;

function csvList(values: string[]): string {
  // Excel list formula must be quoted.
  return `"${values.join(",")}"`;
}

function headerStyle() {
  return {
    font: { bold: true, color: { argb: "FFFFFFFF" } },
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1F4E79" } },
    alignment: { vertical: "middle" as const, horizontal: "center" as const },
  };
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Determine accessible properties (super_admin sees all).
  const { data: memberships, error: mErr } = await supabase
    .from("memberships")
    .select("tenant_id, role");

  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }

  const roles = (memberships ?? []).map((m: { role?: string | null }) => (m.role ?? "").toLowerCase());
  const isSuperAdmin = roles.includes("super_admin");

  const tenantIds = [...new Set((memberships ?? []).map((m: { tenant_id?: string | null }) => m.tenant_id).filter(Boolean))] as string[];

  const propQuery = supabase.from("properties").select("id, name, city");
  const { data: props, error: pErr } = isSuperAdmin || tenantIds.length === 0
    ? await propQuery.order("name", { ascending: true })
    : await propQuery.in("tenant_id", tenantIds).order("name", { ascending: true });

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  const propertyNames = (props ?? []).map((p: { name?: string | null }) => (p.name ?? "").trim()).filter(Boolean);
  const exampleProperty = propertyNames[0] ?? "Property name";

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Property Management";
  workbook.created = new Date();

  // Hidden sheet with dropdown lists (property_name).
  const lists = workbook.addWorksheet("Lists");
  lists.state = "hidden";
  lists.getCell("A1").value = "tenant_name";
  lists.getCell("B1").value = "property_name";

  // Tenant names for dropdown.
  let tenantsRows: Array<{ id: string; name: string }> = [];
  if (isSuperAdmin) {
    const { data: tr, error: trErr } = await supabase.from("tenants").select("id, name").limit(2000);
    if (!trErr && tr) tenantsRows = tr as Array<{ id: string; name: string }>;
  } else if (tenantIds.length > 0) {
    const { data: tr, error: trErr } = await supabase
      .from("tenants")
      .select("id, name")
      .in("id", tenantIds)
      .limit(2000);
    if (!trErr && tr) tenantsRows = tr as Array<{ id: string; name: string }>;
  }

  const tenantNames = (tenantsRows ?? [])
    .map((t) => (t?.name ?? "").trim())
    .filter(Boolean);

  const exampleTenantName = tenantNames[0] ?? "Organization name";

  for (let i = 0; i < tenantNames.length; i++) {
    lists.getCell(`A${i + 2}`).value = tenantNames[i];
  }
  if (tenantNames.length === 0) {
    lists.getCell("A2").value = "Organization name";
  }

  for (let i = 0; i < propertyNames.length; i++) {
    lists.getCell(`B${i + 2}`).value = propertyNames[i];
  }
  if (propertyNames.length === 0) {
    lists.getCell("B2").value = "Property name";
  }

  const sheetColumns = COLUMN_ORDER.map((k) => k);

  for (const type of SPACE_TYPES) {
    const ws = workbook.addWorksheet(type);

    // Merge & instruction row.
    ws.mergeCells(1, 1, 1, sheetColumns.length);
    ws.getCell(1, 1).value =
      "Instructions: Fill rows starting at row 4. " +
      "• property_name must match the property name exactly. " +
      "• space_status must be one of: available, occupied, under_maintenance. " +
      "• requires_approval must be yes/no. " +
      "• amenities: comma-separated tokens like projector, whiteboard, kitchen_access, parking, natural_light, air_conditioning, standing_desk, phone_booth, reception_service. " +
      "Tip: For offices, monthly_rent should be filled; for other room types, leave monthly_rent empty.";
    ws.getCell(1, 1).alignment = { wrapText: true, vertical: "top", horizontal: "left" };

    // Example row 2.
    ws.getCell(2, 1).value = exampleTenantName; // tenant_name
    ws.getCell(2, 2).value = exampleProperty; // property_name
    ws.getCell(2, 3).value = "Example room";
    ws.getCell(2, 4).value = type; // space_type
    ws.getCell(2, 5).value = "1";
    ws.getCell(2, 6).value = "101";
    ws.getCell(2, 7).value = 4;
    ws.getCell(2, 8).value = 25;
    ws.getCell(2, 9).value = type === "office" ? null : 50; // hourly_price
    ws.getCell(2, 10).value = type === "office" ? 1500 : null; // monthly_rent
    ws.getCell(2, 11).value = "no"; // requires_approval
    ws.getCell(2, 12).value = "available"; // space_status
    ws.getCell(2, 13).value = type === "office" ? "parking, reception_service" : "projector, whiteboard";
    ws.getCell(2, 14).value = "Optional notes";

    // Headers row 3 (color-coded).
    for (let c = 0; c < sheetColumns.length; c++) {
      const col = c + 1;
      ws.getCell(3, col).value = sheetColumns[c];
      ws.getCell(3, col).style = headerStyle();
    }

    ws.views = [{ state: "frozen", xSplit: 0, ySplit: 3 }];

    // Column widths
    const widths: Record<(typeof COLUMN_ORDER)[number], number> = {
      tenant_name: 22,
      property_name: 22,
      room_name: 18,
      space_type: 16,
      floor: 10,
      room_number: 12,
      capacity: 10,
      size_m2: 10,
      hourly_price: 12,
      monthly_rent: 12,
      requires_approval: 16,
      space_status: 18,
      amenities: 36,
      notes: 24,
    };
    for (let c = 0; c < sheetColumns.length; c++) {
      const key = sheetColumns[c] as (typeof COLUMN_ORDER)[number];
      ws.getColumn(c + 1).width = widths[key] ?? 14;
    }

    // Dropdown validations (rows 4..1000).
    const startRow = 4;
    const endRow = 1000;

    const propertyListRange = `Lists!$A$2:$A$${Math.max(2, propertyNames.length + 1)}`;
    for (let r = startRow; r <= endRow; r++) {
      // tenant_name dropdown
      ws.getCell(r, 1).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [csvList(tenantNames.length ? tenantNames : ["Organization name"])],
      };

      // property_name dropdown
      ws.getCell(r, 2).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [
          `Lists!$B$2:$B$${Math.max(2, propertyNames.length + 1)}`,
        ],
      };

      // space_type dropdown
      ws.getCell(r, 4).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [csvList([...SPACE_TYPES])],
      };

      // requires_approval dropdown
      ws.getCell(r, 11).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [csvList([...REQUIRES_APPROVAL_VALUES])],
      };

      // space_status dropdown
      ws.getCell(r, 12).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [csvList([...STATUS_VALUES])],
      };
    }

    // Data validations already apply to the data range; rows 4..N can be filled by managers.
  }

  const buf = await workbook.xlsx.writeBuffer();
  const out = Buffer.from(buf);

  return new NextResponse(out, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rooms_import_template.xlsx"`,
    },
  });
}

