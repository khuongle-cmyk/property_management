import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertPropertyFinancialAccess } from "@/lib/property-costs/access";
import {
  isPropertyCostType,
  isRecurringFrequency,
  type RecurringFrequency,
} from "@/lib/property-costs/constants";
import { expandRecurringTemplate, monthKeyFromIsoDate } from "@/lib/property-costs/expand-scheduled";

function periodMonthFromCostDate(costDate: string): string {
  const d = new Date(`${costDate.slice(0, 10)}T12:00:00.000Z`);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

type PostBody = {
  propertyId?: string;
  costType?: string;
  description?: string;
  amount?: number;
  costDate?: string;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  notes?: string | null;
  recurring?: boolean;
  recurringFrequency?: string | null;
  /** First day of end month, optional (YYYY-MM-01) */
  recurringEndMonth?: string | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const propertyId = url.searchParams.get("propertyId")?.trim();
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = await assertPropertyFinancialAccess(supabase, user.id, propertyId, "read");
  if (!gate.ok) return NextResponse.json({ error: gate.error ?? "Forbidden" }, { status: 403 });

  const { data: entries, error: eErr } = await supabase
    .from("property_cost_entries")
    .select("*")
    .eq("property_id", propertyId)
    .order("period_month", { ascending: false })
    .order("created_at", { ascending: false });

  if (eErr) {
    if (eErr.message.includes("property_cost_entries") || eErr.code === "42P01") {
      return NextResponse.json(
        { error: "Cost tables not found. Run sql/property_costs_net_income.sql." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: eErr.message }, { status: 500 });
  }

  const { data: templates, error: tErr } = await supabase
    .from("property_recurring_cost_templates")
    .select("*")
    .eq("property_id", propertyId)
    .order("start_month", { ascending: false });

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  return NextResponse.json({ entries: entries ?? [], templates: templates ?? [] });
}

export async function POST(req: Request) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const propertyId = body.propertyId?.trim();
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  }

  const costType = (body.costType ?? "").trim().toLowerCase();
  if (!isPropertyCostType(costType)) {
    return NextResponse.json({ error: "Invalid costType" }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: "amount must be a non-negative number" }, { status: 400 });
  }

  const costDate = (body.costDate ?? "").trim().slice(0, 10);
  if (!costDate || !/^\d{4}-\d{2}-\d{2}$/.test(costDate)) {
    return NextResponse.json({ error: "costDate must be YYYY-MM-DD" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = await assertPropertyFinancialAccess(supabase, user.id, propertyId, "write");
  if (!gate.ok) return NextResponse.json({ error: gate.error ?? "Forbidden" }, { status: 403 });

  const recurring = !!body.recurring;
  const description = (body.description ?? "").trim() || "(no description)";
  const supplierName = body.supplierName?.trim() || null;
  const invoiceNumber = body.invoiceNumber?.trim() || null;
  const notes = body.notes?.trim() || null;
  const periodMonth = periodMonthFromCostDate(costDate);

  if (recurring) {
    const freqRaw = (body.recurringFrequency ?? "monthly").trim().toLowerCase();
    if (!isRecurringFrequency(freqRaw)) {
      return NextResponse.json({ error: "recurringFrequency must be monthly, quarterly, or yearly" }, { status: 400 });
    }
    const recurringFrequency = freqRaw as RecurringFrequency;

    let endMonth: string | null = null;
    if (body.recurringEndMonth?.trim()) {
      endMonth = body.recurringEndMonth.trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endMonth)) {
        return NextResponse.json({ error: "recurringEndMonth must be YYYY-MM-01" }, { status: 400 });
      }
    }

    const startMonthKey = monthKeyFromIsoDate(periodMonth);
    const start_month = `${startMonthKey}-01`;

    const { data: tpl, error: insErr } = await supabase
      .from("property_recurring_cost_templates")
      .insert({
        property_id: propertyId,
        cost_type: costType,
        description,
        amount,
        supplier_name: supplierName,
        recurring_frequency: recurringFrequency,
        start_month,
        end_month: endMonth,
        notes,
        active: true,
      })
      .select("*")
      .single();

    if (insErr) {
      if (insErr.message.includes("property_recurring_cost_templates")) {
        return NextResponse.json(
          { error: "Cost tables not found. Run sql/property_costs_net_income.sql." },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    const ex = await expandRecurringTemplate(supabase, {
      id: tpl.id as string,
      property_id: propertyId,
      cost_type: costType,
      description,
      amount,
      supplier_name: supplierName,
      recurring_frequency: recurringFrequency,
      start_month: tpl.start_month as string,
      end_month: (tpl.end_month as string | null) ?? null,
      notes,
    });

    if (ex.error) {
      return NextResponse.json({ error: ex.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, template: tpl });
  }

  const { data: row, error } = await supabase
    .from("property_cost_entries")
    .insert({
      property_id: propertyId,
      cost_type: costType,
      description,
      amount,
      cost_date: costDate,
      period_month: periodMonth,
      supplier_name: supplierName,
      invoice_number: invoiceNumber,
      notes,
      status: "confirmed",
      source: "manual",
      recurring_template_id: null,
    })
    .select("*")
    .single();

  if (error) {
    if (error.message.includes("property_cost_entries")) {
      return NextResponse.json(
        { error: "Cost tables not found. Run sql/property_costs_net_income.sql." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, entry: row });
}
