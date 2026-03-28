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

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === "," && !inQ) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out.map((s) => s.replace(/^"|"$/g, ""));
}

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .map(parseCsvLine);
}

type ImportRow = {
  rowNumber: number;
  ok: boolean;
  error?: string;
  entryId?: string;
  templateId?: string;
};

type Body = {
  propertyId?: string;
  /** Raw CSV including header row */
  csvText?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const propertyId = body.propertyId?.trim();
  const csvText = body.csvText ?? "";
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  if (!csvText.trim()) return NextResponse.json({ error: "csvText is required" }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gate = await assertPropertyFinancialAccess(supabase, user.id, propertyId, "write");
  if (!gate.ok) return NextResponse.json({ error: gate.error ?? "Forbidden" }, { status: 403 });

  const grid = parseCsv(csvText);
  if (grid.length < 2) {
    return NextResponse.json({ error: "CSV must include a header row and at least one data row" }, { status: 400 });
  }

  const header = grid[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const colDate = idx("date");
  const colType = idx("cost_type");
  const colDesc = idx("description");
  const colAmt = idx("amount");
  const colSup = idx("supplier");
  const colInv = idx("invoice_number");
  const colRec = idx("recurring");
  const colFreq = idx("recurring_frequency");
  const colNotes = idx("notes");

  if (colDate < 0 || colType < 0 || colDesc < 0 || colAmt < 0) {
    return NextResponse.json(
      { error: "CSV must have columns: date, cost_type, description, amount" },
      { status: 400 },
    );
  }

  const results: ImportRow[] = [];

  for (let r = 1; r < grid.length; r++) {
    const rowNumber = r + 1;
    const cells = grid[r];
    const fail = (msg: string) => {
      results.push({ rowNumber, ok: false, error: msg });
    };

    const dateStr = (cells[colDate] ?? "").trim().slice(0, 10);
    const ctype = (cells[colType] ?? "").trim().toLowerCase();
    const desc = (cells[colDesc] ?? "").trim() || "(import)";
    const amtRaw = (cells[colAmt] ?? "").trim().replace(",", ".");
    const supplier = colSup >= 0 ? (cells[colSup] ?? "").trim() || null : null;
    const invoice = colInv >= 0 ? (cells[colInv] ?? "").trim() || null : null;
    const recRaw = colRec >= 0 ? (cells[colRec] ?? "").trim().toLowerCase() : "no";
    const freqRaw = colFreq >= 0 ? (cells[colFreq] ?? "").trim().toLowerCase() : "monthly";
    const notes = colNotes >= 0 ? (cells[colNotes] ?? "").trim() || null : null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      fail("date must be YYYY-MM-DD");
      continue;
    }
    if (!isPropertyCostType(ctype)) {
      fail("invalid cost_type");
      continue;
    }
    const amount = Number(amtRaw);
    if (!Number.isFinite(amount) || amount < 0) {
      fail("invalid amount");
      continue;
    }

    const recurring = recRaw === "yes" || recRaw === "true" || recRaw === "1";
    const periodMonth = periodMonthFromCostDate(dateStr);

    if (recurring) {
      const freq =
        freqRaw && isRecurringFrequency(freqRaw) ? (freqRaw as RecurringFrequency) : ("monthly" as RecurringFrequency);
      const start_month = `${monthKeyFromIsoDate(periodMonth)}-01`;

      const { data: tpl, error: insErr } = await supabase
        .from("property_recurring_cost_templates")
        .insert({
          property_id: propertyId,
          cost_type: ctype,
          description: desc,
          amount,
          supplier_name: supplier,
          recurring_frequency: freq,
          start_month,
          end_month: null,
          notes,
          active: true,
        })
        .select("*")
        .single();

      if (insErr) {
        fail(insErr.message);
        continue;
      }

      const ex = await expandRecurringTemplate(supabase, {
        id: tpl.id as string,
        property_id: propertyId,
        cost_type: ctype,
        description: desc,
        amount,
        supplier_name: supplier,
        recurring_frequency: freq,
        start_month: tpl.start_month as string,
        end_month: null,
        notes,
      });
      if (ex.error) {
        fail(ex.error);
        continue;
      }
      results.push({ rowNumber, ok: true, templateId: tpl.id as string });
      continue;
    }

    const { data: row, error } = await supabase
      .from("property_cost_entries")
      .insert({
        property_id: propertyId,
        cost_type: ctype,
        description: desc,
        amount,
        cost_date: dateStr,
        period_month: periodMonth,
        supplier_name: supplier,
        invoice_number: invoice,
        notes,
        status: "confirmed",
        source: "csv",
        recurring_template_id: null,
      })
      .select("id")
      .single();

    if (error) {
      fail(error.message);
      continue;
    }
    results.push({ rowNumber, ok: true, entryId: row.id as string });
  }

  const okCount = results.filter((x) => x.ok).length;
  const errCount = results.length - okCount;
  return NextResponse.json({ ok: errCount === 0, results, imported: okCount, failed: errCount });
}
