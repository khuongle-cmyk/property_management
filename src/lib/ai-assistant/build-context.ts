import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMemberships, resolveAllowedPropertyIds } from "@/lib/reports/report-access";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function monthLabel(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Rolling last 12 calendar months ending current UTC month. */
function last12MonthBounds(): { startY: number; startM: number; endY: number; endM: number } {
  const d = new Date();
  const endY = d.getUTCFullYear();
  const endM = d.getUTCMonth() + 1;
  let startY = endY;
  let startM = endM - 11;
  while (startM < 1) {
    startM += 12;
    startY -= 1;
  }
  return { startY, startM, endY, endM };
}

function monthInRange(y: number, m: number, startY: number, startM: number, endY: number, endM: number): boolean {
  const v = y * 12 + m;
  return v >= startY * 12 + startM && v <= endY * 12 + endM;
}

export type AssistantContextPack = {
  userName: string;
  orgName: string;
  propertyNames: string[];
  /** Compact text block for the system prompt */
  contextData: string;
};

/**
 * Loads tenant-scoped aggregates for the AI (RLS applies). Best-effort: missing tables are skipped.
 */
export async function buildAssistantContext(
  supabase: SupabaseClient,
  userId: string,
  userEmail: string,
  displayName: string,
): Promise<AssistantContextPack> {
  const userName = displayName || userEmail || "User";

  const { data: memRows } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", userId);
  const memberships = (memRows ?? []) as { tenant_id: string | null; role: string | null }[];
  const { isSuperAdmin, scopedTenantIds } = normalizeMemberships(memberships);

  if (!isSuperAdmin && scopedTenantIds.length === 0) {
    return {
      userName,
      orgName: "—",
      propertyNames: [],
      contextData: "No organization membership found for this user; no tenant data was loaded.",
    };
  }

  const tenantIds = isSuperAdmin
    ? null
    : (scopedTenantIds.length ? scopedTenantIds : []);

  let orgName = "—";
  const tidForName = tenantIds?.[0] ?? null;
  if (tidForName) {
    const { data: t } = await supabase.from("tenants").select("name").eq("id", tidForName).maybeSingle();
    if (t?.name) orgName = String(t.name);
  } else if (isSuperAdmin) {
    orgName = "Platform (all organizations)";
  }

  let propQuery = supabase.from("properties").select("id, name, tenant_id").order("name", { ascending: true }).limit(200);
  if (!isSuperAdmin && tenantIds && tenantIds.length > 0) {
    propQuery = propQuery.in("tenant_id", tenantIds);
  }
  const { data: propsRaw } = await propQuery;
  const properties = (propsRaw ?? []) as { id: string; name: string | null; tenant_id: string | null }[];
  const propertyNames = properties.map((p) => p.name ?? p.id.slice(0, 8));
  const propertyIds = properties.map((p) => p.id);

  const { allowedIds } = await resolveAllowedPropertyIds(supabase, isSuperAdmin, scopedTenantIds, null);
  const allowedSet = new Set(allowedIds);
  const scopedPropIds = propertyIds.filter((id) => allowedSet.has(id));
  const propIds = scopedPropIds.length > 0 ? scopedPropIds : propertyIds;

  const bounds = last12MonthBounds();
  const lines: string[] = [];

  lines.push(`Properties (${propIds.length}): ${properties.map((p) => `${p.name ?? p.id} [${p.id.slice(0, 8)}…]`).join("; ") || "none"}.`);

  // —— Financials: historical_revenue / historical_costs (last ~12 months) ——
  if (propIds.length > 0) {
    const minYear = bounds.startY - 1;
    const { data: revRows, error: rErr } = await supabase
      .from("historical_revenue")
      .select("property_id, year, month, office_rent_revenue, meeting_room_revenue, hot_desk_revenue, venue_revenue, virtual_office_revenue, furniture_revenue, additional_services_revenue")
      .in("property_id", propIds)
      .gte("year", minYear);

    if (!rErr && revRows?.length) {
      const byPropMonth = new Map<string, number>();
      const byMonth = new Map<string, number>();
      for (const row of revRows as Record<string, unknown>[]) {
        const y = num(row.year);
        const m = num(row.month);
        if (!monthInRange(y, m, bounds.startY, bounds.startM, bounds.endY, bounds.endM)) continue;
        const pid = String(row.property_id ?? "");
        let t = 0;
        t += num(row.office_rent_revenue);
        t += num(row.meeting_room_revenue);
        t += num(row.hot_desk_revenue);
        t += num(row.venue_revenue);
        t += num(row.virtual_office_revenue);
        t += num(row.furniture_revenue);
        t += num(row.additional_services_revenue);
        const mk = monthLabel(y, m);
        byMonth.set(mk, (byMonth.get(mk) ?? 0) + t);
        byPropMonth.set(`${pid}|${mk}`, (byPropMonth.get(`${pid}|${mk}`) ?? 0) + t);
      }
      const revSummary = [...byMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}: €${Math.round(v).toLocaleString("fi-FI")}`)
        .join("; ");
      lines.push(`Historical revenue (last 12 months, totals € by month): ${revSummary || "no rows"}.`);

      if (properties[0]) {
        const pid = properties[0].id;
        const perProp = [...byPropMonth.entries()]
          .filter(([k]) => k.startsWith(`${pid}|`))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => {
            const mk = k.split("|")[1] ?? "";
            return `${mk}:€${Math.round(v)}`;
          })
          .join("; ");
        if (perProp) {
          lines.push(`Per-property revenue sample (${properties[0].name ?? pid}): ${perProp}.`);
        }
      }
    } else if (rErr && rErr.code !== "42P01") {
      lines.push(`historical_revenue: unavailable (${rErr.message}).`);
    }

    const { data: costRows, error: cErr } = await supabase
      .from("historical_costs")
      .select("property_id, year, month, amount_ex_vat, cost_type")
      .in("property_id", propIds)
      .gte("year", minYear);

    if (!cErr && costRows?.length) {
      const byMonth = new Map<string, number>();
      const byType = new Map<string, number>();
      for (const row of costRows as Record<string, unknown>[]) {
        const y = num(row.year);
        const m = num(row.month);
        if (!monthInRange(y, m, bounds.startY, bounds.startM, bounds.endY, bounds.endM)) continue;
        const amt = num(row.amount_ex_vat);
        const mk = monthLabel(y, m);
        byMonth.set(mk, (byMonth.get(mk) ?? 0) + amt);
        const ct = String(row.cost_type ?? "other");
        byType.set(ct, (byType.get(ct) ?? 0) + amt);
      }
      lines.push(
        `Historical costs (last 12 months, sum amount_ex_vat by month): ${[...byMonth.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}: €${Math.round(v).toLocaleString("fi-FI")}`)
          .join("; ") || "none"}.`,
      );
      const topCost = [...byType.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5);
      lines.push(`Top cost categories (approx): ${topCost.map(([k, v]) => `${k}=${Math.round(v)}`).join(", ") || "—"}.`);
    } else if (cErr && cErr.code !== "42P01") {
      lines.push(`historical_costs: unavailable (${cErr.message}).`);
    }
  }

  // —— Spaces / occupancy ——
  if (propIds.length > 0) {
    const { data: spaces, error: sErr } = await supabase
      .from("bookable_spaces")
      .select("id, property_id, space_status, space_type, name")
      .in("property_id", propIds);
    if (!sErr && spaces?.length) {
      const byStatus = new Map<string, number>();
      for (const s of spaces as { space_status?: string | null }[]) {
        const st = String(s.space_status ?? "unknown");
        byStatus.set(st, (byStatus.get(st) ?? 0) + 1);
      }
      lines.push(`Bookable spaces by status: ${[...byStatus.entries()].map(([k, v]) => `${k}:${v}`).join(", ")} (total ${spaces.length}).`);
    } else if (sErr && sErr.code !== "42P01") {
      lines.push(`bookable_spaces: unavailable (${sErr.message}).`);
    }
  }

  // —— Tasks ——
  const taskTenantFilter = tenantIds && tenantIds.length > 0 ? tenantIds : null;
  let taskQ = supabase
    .from("client_tasks")
    .select("id, title, status, due_date, tenant_id")
    .neq("status", "done")
    .limit(80);
  if (taskTenantFilter) {
    taskQ = taskQ.in("tenant_id", taskTenantFilter);
  }
  const { data: tasks, error: tErr } = await taskQ;
  if (!tErr && tasks?.length) {
    const today = new Date().toISOString().slice(0, 10);
    let overdue = 0;
    for (const t of tasks as { due_date?: string | null }[]) {
      const d = t.due_date;
      if (d && d < today) overdue++;
    }
    lines.push(
      `Open tasks (not done): ${tasks.length} total; ${overdue} with due_date before ${today}. Titles: ${(tasks as { title?: string }[])
        .slice(0, 12)
        .map((x) => x.title ?? "")
        .join("; ")}${tasks.length > 12 ? "…" : ""}.`,
    );
  } else if (!tErr) {
    lines.push("Open tasks: none or table empty.");
  } else if (tErr.code !== "42P01") {
    lines.push(`client_tasks: unavailable (${tErr.message}).`);
  }

  // —— CRM leads ——
  let leadQ = supabase.from("leads").select("id, stage, company_name").or("archived.eq.false,archived.is.null").limit(120);
  if (taskTenantFilter) {
    leadQ = leadQ.in("tenant_id", taskTenantFilter);
  }
  const { data: leads, error: lErr } = await leadQ;
  if (!lErr && leads?.length) {
    const byStage = new Map<string, number>();
    for (const l of leads as { stage?: string | null }[]) {
      const st = String(l.stage ?? "unknown");
      byStage.set(st, (byStage.get(st) ?? 0) + 1);
    }
    lines.push(`Leads by stage: ${[...byStage.entries()].map(([k, v]) => `${k}:${v}`).join(", ")}.`);
  } else if (!lErr) {
    lines.push("Leads: none.");
  } else if (lErr.code !== "42P01") {
    lines.push(`leads: unavailable (${lErr.message}).`);
  }

  // —— Bookings tomorrow (meeting-style) ——
  if (propIds.length > 0) {
    const t0 = new Date();
    t0.setUTCDate(t0.getUTCDate() + 1);
    t0.setUTCHours(0, 0, 0, 0);
    const t1 = new Date(t0);
    t1.setUTCDate(t1.getUTCDate() + 1);
    const { data: books, error: bErr } = await supabase
      .from("bookings")
      .select("id, property_id, start_at, end_at, status, space_id")
      .in("property_id", propIds)
      .gte("start_at", t0.toISOString())
      .lt("start_at", t1.toISOString())
      .limit(40);
    if (!bErr && books?.length) {
      lines.push(`Bookings starting tomorrow (${t0.toISOString().slice(0, 10)}): ${books.length} rows.`);
    } else if (!bErr) {
      lines.push("Bookings starting tomorrow: none in range.");
    } else if (bErr.code !== "42P01") {
      lines.push(`bookings: unavailable (${bErr.message}).`);
    }
  }

  const contextData = lines.join("\n");
  return {
    userName,
    orgName,
    propertyNames,
    contextData: contextData.slice(0, 24000),
  };
}
