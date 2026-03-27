import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecurringFrequency } from "./constants";

function parseMK(mk: string): { y: number; m: number } {
  const [y, m] = mk.split("-").map(Number);
  return { y, m: m || 1 };
}

function mkFrom(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** First-of-month ISO date → YYYY-MM */
export function monthKeyFromIsoDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Generate calendar months for a recurring template. When endMonthKey is null,
 * stops after `defaultHorizon` months.
 */
export function iterPeriodMonths(
  startMonthKey: string,
  endMonthKey: string | null,
  frequency: RecurringFrequency,
  defaultHorizon = 36,
  maxSteps = 200,
): string[] {
  const out: string[] = [];
  let { y, m } = parseMK(startMonthKey);
  const endCap = endMonthKey ? parseMK(endMonthKey) : null;

  function afterEnd(): boolean {
    if (!endCap) return false;
    return y > endCap.y || (y === endCap.y && m > endCap.m);
  }

  for (let i = 0; i < maxSteps; i++) {
    if (afterEnd()) break;
    out.push(mkFrom(y, m));
    if (frequency === "monthly") {
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    } else if (frequency === "quarterly") {
      m += 3;
      while (m > 12) {
        m -= 12;
        y++;
      }
    } else {
      y++;
    }
    if (!endCap && out.length >= defaultHorizon) break;
  }
  return out;
}

type TemplateRow = {
  id: string;
  property_id: string;
  cost_type: string;
  description: string;
  amount: number;
  supplier_name: string | null;
  recurring_frequency: RecurringFrequency;
  start_month: string;
  end_month: string | null;
  notes: string | null;
};

/** Inserts missing scheduled rows for a recurring template (idempotent). */
export async function expandRecurringTemplate(
  supabase: SupabaseClient,
  template: TemplateRow,
): Promise<{ error: string | null }> {
  const startMk = monthKeyFromIsoDate(template.start_month);
  const endMk = template.end_month ? monthKeyFromIsoDate(template.end_month) : null;
  const months = iterPeriodMonths(startMk, endMk, template.recurring_frequency);

  const { data: existing, error: exErr } = await supabase
    .from("property_cost_entries")
    .select("period_month")
    .eq("recurring_template_id", template.id)
    .neq("status", "cancelled");

  if (exErr) return { error: exErr.message };

  const have = new Set(
    (existing ?? []).map((r: { period_month: string }) => monthKeyFromIsoDate(r.period_month)),
  );

  const inserts: Record<string, unknown>[] = [];
  for (const mk of months) {
    if (have.has(mk)) continue;
    const periodMonth = `${mk}-01`;
    inserts.push({
      property_id: template.property_id,
      cost_type: template.cost_type,
      description: template.description,
      amount: template.amount,
      cost_date: periodMonth,
      period_month: periodMonth,
      supplier_name: template.supplier_name,
      invoice_number: null as string | null,
      notes: template.notes,
      status: "scheduled",
      source: "recurring",
      recurring_template_id: template.id,
    });
  }

  if (inserts.length === 0) return { error: null };
  const { error } = await supabase.from("property_cost_entries").insert(inserts);
  return { error: error?.message ?? null };
}
