import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isPropertyCostType } from "@/lib/property-costs/constants";
import { parseFinNumber } from "@/lib/procountor/finnish-number";
import type { DataSource, DuplicateMode, ImportType, ParsedRow } from "@/lib/historical-import/types";

type Body = {
  importType?: ImportType;
  duplicateMode?: DuplicateMode;
  sourceSoftware?: string | null;
  fileName?: string | null;
  dataSource?: DataSource;
  rows?: ParsedRow[];
  procountorExportType?: "sales_invoices" | "purchase_invoices" | "income_statement";
  tenantId?: string | null;
};

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.includes(",")) {
    const n = parseFinNumber(s);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string {
  return String(v ?? "").trim();
}

function rowSnapshot(r: ParsedRow): string {
  try {
    return JSON.stringify(r).slice(0, 4000);
  } catch {
    return "[unserializable row]";
  }
}

type ImportErrorLogEntry = { row: number; text: string; error: string };

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const importType = body.importType;
  const duplicateMode = body.duplicateMode ?? "skip";
  const rows = body.rows ?? [];
  const dataSource = body.dataSource ?? "excel";
  if (!importType || !["revenue", "costs", "invoices", "occupancy"].includes(importType)) {
    return NextResponse.json({ error: "Invalid importType" }, { status: 400 });
  }
  if (!["skip", "overwrite", "merge"].includes(duplicateMode)) {
    return NextResponse.json({ error: "Invalid duplicateMode" }, { status: 400 });
  }
  if (!rows.length) return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  const requestedTenantId = str(body.tenantId);

  console.log("[import/commit] Total rows:", rows.length, "importType:", importType, "dataSource:", dataSource);
  for (let j = 0; j < Math.min(5, rows.length); j++) {
    console.log("[import/commit] Row sample (index", j, "):", rows[j]);
  }

  const { data: memberships, error: mErr } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  const roleRows = (memberships ?? []).map((m) => ({
    role: (m.role ?? "").toLowerCase(),
    tenant_id: m.tenant_id,
  }));
  const isSuperAdmin = roleRows.some((m) => m.role === "super_admin");
  const manageRoles = new Set(["super_admin", "owner", "manager"]);
  const allowedTenantIds = [...new Set(roleRows.filter((m) => manageRoles.has(m.role)).map((m) => m.tenant_id).filter(Boolean))] as string[];
  if (!isSuperAdmin && !allowedTenantIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (requestedTenantId && !isSuperAdmin && !allowedTenantIds.includes(requestedTenantId)) {
    return NextResponse.json({ error: "Requested tenant not in your scope" }, { status: 403 });
  }

  let pq = supabase.from("properties").select("id,name,tenant_id");
  if (!isSuperAdmin) pq = pq.in("tenant_id", allowedTenantIds);
  if (requestedTenantId) pq = pq.eq("tenant_id", requestedTenantId);
  const { data: propRows, error: pErr } = await pq;
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  const properties = (propRows ?? []) as Array<{ id: string; name: string | null; tenant_id: string | null }>;
  if (!properties.length) return NextResponse.json({ error: "No accessible properties in scope" }, { status: 400 });
  const byId = new Map(properties.map((p) => [p.id, p]));
  const byName = new Map(properties.map((p) => [(p.name ?? "").toLowerCase(), p]));

  const batchTenant = requestedTenantId || properties[0]?.tenant_id || null;
  if (!batchTenant) return NextResponse.json({ error: "Missing organization scope for import" }, { status: 400 });
  const { data: batch, error: bErr } = await supabase
    .from("import_batches")
    .insert({
      tenant_id: batchTenant,
      property_id: null,
      import_type: importType,
      source_software: body.sourceSoftware ?? null,
      file_name: body.fileName ?? null,
      imported_by: user.id,
      rows_imported: 0,
      rows_failed: 0,
    })
    .select("id")
    .maybeSingle();
  if (bErr || !batch) return NextResponse.json({ error: bErr?.message ?? "Could not create batch" }, { status: 500 });
  const batchId = batch.id as string;

  let imported = 0;
  let failed = 0;
  const errors: ImportErrorLogEntry[] = [];
  const rowResults: Array<{ row: number; ok: boolean; message?: string }> = [];

  async function resolveProperty(row: ParsedRow): Promise<{ id: string; tenant_id: string } | null> {
    const pid = str(row.property_id);
    if (pid && byId.has(pid)) {
      const p = byId.get(pid)!;
      if (!p.tenant_id) return null;
      return { id: p.id, tenant_id: p.tenant_id };
    }
    const name = str(row.property).toLowerCase();
    if (name && byName.has(name)) {
      const p = byName.get(name)!;
      if (!p.tenant_id) return null;
      return { id: p.id, tenant_id: p.tenant_id };
    }
    return null;
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const p = await resolveProperty(r);
    if (!p) {
      failed++;
      const msg = "Property not found / not in scope";
      const entry: ImportErrorLogEntry = { row: i + 1, text: rowSnapshot(r), error: msg };
      errors.push(entry);
      rowResults.push({ row: i + 1, ok: false, message: msg });
      console.log("[import/commit] ERROR:", msg, "Row:", i + 1, "payload:", entry.text.slice(0, 500));
      continue;
    }

    try {
      if (importType === "revenue") {
        const year = Number(r.year);
        const month = Number(r.month);
        if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("Invalid year/month");
        const office = num(r.office_rent_revenue) ?? 0;
        const meeting = num(r.meeting_room_revenue) ?? 0;
        const hotDesk = num(r.hot_desk_revenue) ?? 0;
        const venue = num(r.venue_revenue) ?? 0;
        const addl = num(r.additional_services_revenue) ?? 0;
        const virtualOffice = num((r as ParsedRow & { virtual_office_revenue?: unknown }).virtual_office_revenue) ?? 0;
        const furniture = num((r as ParsedRow & { furniture_revenue?: unknown }).furniture_revenue) ?? 0;
        const total = num(r.total_revenue) ?? office + meeting + hotDesk + venue + addl + virtualOffice + furniture;
        if ([office, meeting, hotDesk, venue, addl, virtualOffice, furniture, total].some((n) => n < 0)) throw new Error("Amounts must be positive");

        const payload = {
          property_id: p.id,
          tenant_id: p.tenant_id,
          year,
          month,
          office_rent_revenue: office,
          meeting_room_revenue: meeting,
          hot_desk_revenue: hotDesk,
          venue_revenue: venue,
          additional_services_revenue: addl,
          virtual_office_revenue: virtualOffice,
          furniture_revenue: furniture,
          total_revenue: total,
          data_source: dataSource,
          account_code: str((r as ParsedRow & { account_code?: unknown }).account_code) || null,
          account_name: str((r as ParsedRow & { account_name?: unknown }).account_name) || null,
          category: str((r as ParsedRow & { category?: unknown }).category) || null,
          import_batch_id: batchId,
        };
        if (duplicateMode === "skip") {
          const { data: ex } = await supabase.from("historical_revenue").select("id").eq("property_id", p.id).eq("year", year).eq("month", month).maybeSingle();
          if (ex?.id) {
            rowResults.push({ row: i + 1, ok: true, message: "Skipped duplicate" });
            continue;
          }
          const { error } = await supabase.from("historical_revenue").insert(payload);
          if (error) throw error;
        } else if (duplicateMode === "overwrite") {
          const { error } = await supabase.from("historical_revenue").upsert(payload, { onConflict: "property_id,year,month" });
          if (error) throw error;
        } else {
          const { data: ex } = await supabase
            .from("historical_revenue")
            .select("id,office_rent_revenue,meeting_room_revenue,hot_desk_revenue,venue_revenue,additional_services_revenue,virtual_office_revenue,furniture_revenue,total_revenue")
            .eq("property_id", p.id)
            .eq("year", year)
            .eq("month", month)
            .maybeSingle();
          if (!ex?.id) {
            const { error } = await supabase.from("historical_revenue").insert(payload);
            if (error) throw error;
          } else {
            const { error } = await supabase
              .from("historical_revenue")
              .update({
                office_rent_revenue: Number(ex.office_rent_revenue || 0) + office,
                meeting_room_revenue: Number(ex.meeting_room_revenue || 0) + meeting,
                hot_desk_revenue: Number(ex.hot_desk_revenue || 0) + hotDesk,
                venue_revenue: Number(ex.venue_revenue || 0) + venue,
                additional_services_revenue: Number(ex.additional_services_revenue || 0) + addl,
                virtual_office_revenue: Number((ex as { virtual_office_revenue?: number }).virtual_office_revenue || 0) + virtualOffice,
                furniture_revenue: Number((ex as { furniture_revenue?: number }).furniture_revenue || 0) + furniture,
                total_revenue: Number(ex.total_revenue || 0) + total,
                import_batch_id: batchId,
              })
              .eq("id", ex.id as string);
            if (error) throw error;
          }
        }
      } else if (importType === "costs") {
        const date = str(r.date || r.cost_date);
        const d = new Date(date);
        if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
        const amountEx = num(r.amount_ex_vat);
        const vatAmount = num(r.vat_amount) ?? 0;
        const totalAmount = num(r.total_amount) ?? ((amountEx ?? 0) + vatAmount);
        if (amountEx == null || amountEx < 0 || vatAmount < 0 || totalAmount < 0) throw new Error("Amounts must be positive");
        const typeRaw = str(r.cost_type).toLowerCase().replace(/\s+/g, "_");
        const costType = typeRaw || (isPropertyCostType(typeRaw) ? typeRaw : "one_off");

        const payload = {
          property_id: p.id,
          tenant_id: p.tenant_id,
          cost_date: date.slice(0, 10),
          year: d.getUTCFullYear(),
          month: d.getUTCMonth() + 1,
          cost_type: costType,
          description: str(r.description) || null,
          amount_ex_vat: amountEx,
          vat_amount: vatAmount,
          total_amount: totalAmount,
          supplier_name: str(r.supplier || r.supplier_name) || null,
          invoice_number: str(r.invoice_number) || null,
          data_source: dataSource,
          account_code: str((r as ParsedRow & { account_code?: unknown }).account_code) || null,
          account_name: str((r as ParsedRow & { account_name?: unknown }).account_name) || null,
          import_batch_id: batchId,
        };
        const { error } = await supabase.from("historical_costs").insert(payload);
        if (error) throw error;
      } else if (importType === "invoices") {
        const invoiceDate = str(r.invoice_date || r.date);
        const dueDate = str(r.due_date);
        if (!invoiceDate || !dueDate) throw new Error("Missing invoice date/due date");
        const amountEx = num(r.amount_ex_vat);
        const vatAmount = num(r.vat_amount) ?? 0;
        const totalAmount = num(r.total_amount) ?? ((amountEx ?? 0) + vatAmount);
        if (amountEx == null || amountEx < 0 || vatAmount < 0 || totalAmount < 0) throw new Error("Amounts must be positive");
        const rawStatus = str(r.status).toLowerCase();
        const status =
          rawStatus === "paid" || rawStatus === "maksettu"
            ? "paid"
            : rawStatus === "overdue" || rawStatus === "erääntynyt"
              ? "overdue"
              : "unpaid";
        const payload = {
          property_id: p.id,
          tenant_id: p.tenant_id,
          invoice_number: str(r.invoice_number),
          invoice_date: invoiceDate.slice(0, 10),
          due_date: dueDate.slice(0, 10),
          client_tenant: str(r.client_tenant || r.client || r.tenant) || null,
          amount_ex_vat: amountEx,
          vat_amount: vatAmount,
          total_amount: totalAmount,
          status,
          payment_date: str(r.payment_date) || null,
          data_source: dataSource,
          import_batch_id: batchId,
        };
        if (!payload.invoice_number) throw new Error("Missing invoice number");
        if (duplicateMode === "overwrite") {
          const { error } = await supabase.from("historical_invoices").upsert(payload, { onConflict: "property_id,invoice_number" });
          if (error) throw error;
        } else {
          const { error } = await supabase.from("historical_invoices").insert(payload);
          if (error) throw error;
        }
      } else if (importType === "occupancy") {
        const year = Number(r.year);
        const month = Number(r.month);
        if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("Invalid year/month");
        const totalRooms = Number(r.total_rooms);
        const occupiedRooms = Number(r.occupied_rooms);
        if (!Number.isFinite(totalRooms) || !Number.isFinite(occupiedRooms) || totalRooms < 0 || occupiedRooms < 0) {
          throw new Error("Invalid room counts");
        }
        const occupancyPct = num(r.occupancy_pct) ?? (totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0);
        const revM2 = num(r.revenue_per_m2);
        const payload = {
          property_id: p.id,
          tenant_id: p.tenant_id,
          year,
          month,
          total_rooms: totalRooms,
          occupied_rooms: occupiedRooms,
          occupancy_pct: occupancyPct,
          revenue_per_m2: revM2,
          data_source: dataSource,
          import_batch_id: batchId,
        };
        if (duplicateMode === "skip") {
          const { data: ex } = await supabase.from("historical_occupancy").select("id").eq("property_id", p.id).eq("year", year).eq("month", month).maybeSingle();
          if (ex?.id) {
            rowResults.push({ row: i + 1, ok: true, message: "Skipped duplicate" });
            continue;
          }
          const { error } = await supabase.from("historical_occupancy").insert(payload);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("historical_occupancy").upsert(payload, { onConflict: "property_id,year,month" });
          if (error) throw error;
        }
      }
      imported++;
      rowResults.push({ row: i + 1, ok: true });
    } catch (e) {
      failed++;
      let message = "Row failed";
      if (e instanceof Error) message = e.message;
      else if (e && typeof e === "object" && "message" in e) {
        const msg = (e as { message?: unknown }).message;
        if (msg != null) message = String(msg);
        const details = (e as { details?: unknown }).details;
        const hint = (e as { hint?: unknown }).hint;
        if (details != null) message += ` (${String(details)})`;
        else if (hint != null) message += ` (${String(hint)})`;
      }
      const entry: ImportErrorLogEntry = { row: i + 1, text: rowSnapshot(r), error: message };
      errors.push(entry);
      rowResults.push({ row: i + 1, ok: false, message });
      console.log("[import/commit] ERROR:", message, "Row:", i + 1, "Row payload:", entry.text.slice(0, 800));
    }
  }

  const { error: batchUpdErr } = await supabase
    .from("import_batches")
    .update({
      rows_imported: imported,
      rows_failed: failed,
      error_log: errors.length ? errors : null,
    })
    .eq("id", batchId);

  if (batchUpdErr) {
    console.error("[import/commit] import_batches update failed (error_log may be missing in DB):", batchUpdErr.message, batchUpdErr);
    const { error: retryErr } = await supabase
      .from("import_batches")
      .update({
        rows_imported: imported,
        rows_failed: failed,
      })
      .eq("id", batchId);
    if (retryErr) {
      console.error("[import/commit] Retry update (counts only) failed:", retryErr.message, retryErr);
    }
  }

  return NextResponse.json({
    ok: true,
    batchId,
    rowsImported: imported,
    rowsFailed: failed,
    errorLog: errors,
    results: rowResults,
  });
}
