import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { classifyHistoricalCostBucket } from "@/lib/reports/cost-classification";

function last12MonthKeysUtc(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 11; i >= 0; i--) {
    const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

type RevRow = {
  property_id: string;
  year: number;
  month: number;
  office_rent_revenue: number | string | null;
  meeting_room_revenue: number | string | null;
  hot_desk_revenue: number | string | null;
  venue_revenue: number | string | null;
  additional_services_revenue: number | string | null;
  virtual_office_revenue?: number | string | null;
  furniture_revenue?: number | string | null;
  total_revenue: number | string | null;
};

type CostRow = {
  property_id: string;
  year: number;
  month: number;
  amount_ex_vat: number | string | null;
  account_code: string | null;
  cost_type: string | null;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function monthKeyFromParts(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function parseMonthKey(mk: string): { y: number; m: number } | null {
  const p = mk.split("-");
  if (p.length < 2) return null;
  const y = Number(p[0]);
  const m = Number(p[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  return { y, m };
}

function prevCalendarMonth(y: number, m: number): { y: number; m: number } {
  if (m <= 1) return { y: y - 1, m: 12 };
  return { y, m: m - 1 };
}

function pctChange(latest: number, prior: number): number | null {
  if (!Number.isFinite(latest) || !Number.isFinite(prior)) return null;
  if (prior === 0) return latest === 0 ? 0 : null;
  return ((latest - prior) / prior) * 100;
}

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const filterPropertyId = (searchParams.get("propertyId") ?? "").trim();

  const { data: mem, error: mErr } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const rows = (mem ?? []) as { tenant_id: string | null; role: string | null }[];
  const isSuperAdmin = rows.some((m) => (m.role ?? "").toLowerCase() === "super_admin");
  const ownerTenantIds = rows
    .filter((m) => (m.role ?? "").toLowerCase() === "owner")
    .map((m) => m.tenant_id)
    .filter(Boolean) as string[];

  if (!isSuperAdmin && ownerTenantIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let propQuery = supabase.from("properties").select("id, name").order("name", { ascending: true });
  if (!isSuperAdmin) propQuery = propQuery.in("tenant_id", ownerTenantIds);
  const { data: props, error: pErr } = await propQuery;
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const propertyList = (props ?? []) as { id: string; name: string | null }[];
  let propertyIds = propertyList.map((p) => p.id);
  if (filterPropertyId) {
    if (!propertyIds.includes(filterPropertyId)) {
      return NextResponse.json({ error: "Invalid property" }, { status: 400 });
    }
    propertyIds = [filterPropertyId];
  }

  const monthKeys = last12MonthKeysUtc();
  const firstMk = monthKeys[0] ?? "";
  const lastMk = monthKeys[monthKeys.length - 1] ?? "";
  const minYear = Number(firstMk.slice(0, 4));
  const maxYear = Number(lastMk.slice(0, 4));
  const now = new Date();
  const cy = now.getUTCFullYear();
  const cm = now.getUTCMonth() + 1;
  const today = now.toISOString().slice(0, 10);
  /** Include prior calendar year so YTD / YoY spans are covered even when the rolling 12‑month window shifts. */
  const wideMinYear = Math.min(minYear, cy - 1);
  const wideMaxYear = Math.max(maxYear, cy);

  const emptyKpis = {
    latestMonthKey: null as string | null,
    revenueLatestMonth: 0,
    revenuePrevMonth: 0,
    revenueMomPct: null as number | null,
    costsLatestMonth: 0,
    costsPrevMonth: 0,
    costsMomPct: null as number | null,
    netLatestMonth: 0,
    netMarginPct: null as number | null,
    revenueYtd: 0,
    revenueYtdPriorYearSamePeriod: 0,
    revenueYtdYoYPct: null as number | null,
    occupancyPct: 0,
    activeContracts: 0,
    openTasksCount: 0,
    overdueOpenTasks: 0,
    pipelineValueEur: 0,
  };

  const emptyPayload = {
    monthKeys,
    kpis: emptyKpis,
    monthlySeries: monthKeys.map((mk) => ({
      monthKey: mk,
      label: mk.slice(5) + "/" + mk.slice(2, 4),
      revenue: 0,
      office: 0,
      meeting: 0,
      hotDesk: 0,
      venue: 0,
      virtualOffice: 0,
      furniture: 0,
      services: 0,
      costsTotal: 0,
      materialsServices: 0,
      personnel: 0,
      otherOperating: 0,
      net: 0,
    })),
    occupancyByProperty: [] as {
      propertyId: string;
      name: string;
      occupancyPct: number;
      leasedOffices: number;
      totalOffices: number;
    }[],
    recentActivities: [] as { id: string; message: string | null; activityType: string; createdAt: string }[],
    upcomingTasks: [] as { id: string; title: string; dueDate: string | null; status: string; propertyId: string | null }[],
  };

  if (propertyIds.length === 0) {
    return NextResponse.json(emptyPayload);
  }

  const propertyScopeOr =
    propertyIds.length > 0
      ? `property_id.in.(${propertyIds.join(",")}),property_id.is.null`
      : "property_id.is.null";

  let revenueRows: RevRow[] = [];
  const revRes = await supabase
    .from("historical_revenue")
    .select(
      "property_id, year, month, office_rent_revenue, meeting_room_revenue, hot_desk_revenue, venue_revenue, additional_services_revenue, virtual_office_revenue, furniture_revenue, total_revenue",
    )
    .in("property_id", propertyIds)
    .gte("year", wideMinYear)
    .lte("year", wideMaxYear);
  if (revRes.error && revRes.error.code !== "42P01") {
    return NextResponse.json({ error: revRes.error.message }, { status: 500 });
  }
  if (!revRes.error) revenueRows = (revRes.data ?? []) as RevRow[];

  let costRows: CostRow[] = [];
  const costSel = await supabase
    .from("historical_costs")
    .select("property_id, year, month, amount_ex_vat, account_code, cost_type")
    .in("property_id", propertyIds)
    .gte("year", wideMinYear)
    .lte("year", wideMaxYear);
  if (costSel.error) {
    if (costSel.error.code !== "42P01" && costSel.error.code !== "42703") {
      return NextResponse.json({ error: costSel.error.message }, { status: 500 });
    }
    if (costSel.error.code === "42703") {
      const c2 = await supabase
        .from("historical_costs")
        .select("property_id, year, month, amount_ex_vat, cost_type")
        .in("property_id", propertyIds)
        .gte("year", wideMinYear)
        .lte("year", wideMaxYear);
      if (c2.error && c2.error.code !== "42P01") {
        return NextResponse.json({ error: c2.error.message }, { status: 500 });
      }
      costRows = ((c2.data ?? []) as Omit<CostRow, "account_code">[]).map((r) => ({ ...r, account_code: null }));
    }
  } else {
    costRows = (costSel.data ?? []) as CostRow[];
  }

  const seriesMap = new Map<
    string,
    {
      revenue: number;
      office: number;
      meeting: number;
      hotDesk: number;
      venue: number;
      virtualOffice: number;
      furniture: number;
      services: number;
      costsTotal: number;
      materialsServices: number;
      personnel: number;
      otherOperating: number;
    }
  >();
  for (const mk of monthKeys) {
    seriesMap.set(mk, {
      revenue: 0,
      office: 0,
      meeting: 0,
      hotDesk: 0,
      venue: 0,
      virtualOffice: 0,
      furniture: 0,
      services: 0,
      costsTotal: 0,
      materialsServices: 0,
      personnel: 0,
      otherOperating: 0,
    });
  }

  const financialByMonth = new Map<string, { revenue: number; costs: number }>();

  for (const r of revenueRows) {
    const mk = monthKeyFromParts(r.year, r.month);
    const office = num(r.office_rent_revenue);
    const meeting = num(r.meeting_room_revenue);
    const hotDesk = num(r.hot_desk_revenue);
    const venue = num(r.venue_revenue);
    const services = num(r.additional_services_revenue);
    const virtualOffice = num(r.virtual_office_revenue);
    const furniture = num(r.furniture_revenue);
    const total = num(r.total_revenue);
    const sumParts = office + meeting + hotDesk + venue + services + virtualOffice + furniture;
    const useTotal = total > 0 ? total : sumParts;

    const fin = financialByMonth.get(mk) ?? { revenue: 0, costs: 0 };
    fin.revenue += useTotal;
    financialByMonth.set(mk, fin);

    if (monthKeys.includes(mk)) {
      const slot = seriesMap.get(mk)!;
      slot.office += office;
      slot.meeting += meeting;
      slot.hotDesk += hotDesk;
      slot.venue += venue;
      slot.services += services;
      slot.virtualOffice += virtualOffice;
      slot.furniture += furniture;
      slot.revenue += useTotal;
    }
  }

  for (const r of costRows) {
    const mk = monthKeyFromParts(r.year, r.month);
    const amt = num(r.amount_ex_vat);
    const fin = financialByMonth.get(mk) ?? { revenue: 0, costs: 0 };
    fin.costs += amt;
    financialByMonth.set(mk, fin);

    if (monthKeys.includes(mk)) {
      const slot = seriesMap.get(mk)!;
      slot.costsTotal += amt;
      const bucket = classifyHistoricalCostBucket(r.account_code, r.cost_type);
      if (bucket === "materials_services") slot.materialsServices += amt;
      else if (bucket === "personnel") slot.personnel += amt;
      else slot.otherOperating += amt;
    }
  }

  let latestMonthKey: string | null = null;
  for (const [mk, v] of financialByMonth) {
    if (v.revenue > 0 || v.costs > 0) {
      if (!latestMonthKey || mk > latestMonthKey) latestMonthKey = mk;
    }
  }
  if (!latestMonthKey) {
    latestMonthKey = monthKeyFromParts(cy, cm);
  }

  const latestParsed = parseMonthKey(latestMonthKey);
  const ly = latestParsed?.y ?? cy;
  const lm = latestParsed?.m ?? cm;
  const prevParts = prevCalendarMonth(ly, lm);
  const prevMonthKey = monthKeyFromParts(prevParts.y, prevParts.m);

  const revenueLatestMonth = financialByMonth.get(latestMonthKey)?.revenue ?? 0;
  const revenuePrevMonth = financialByMonth.get(prevMonthKey)?.revenue ?? 0;
  const costsLatestMonth = financialByMonth.get(latestMonthKey)?.costs ?? 0;
  const costsPrevMonth = financialByMonth.get(prevMonthKey)?.costs ?? 0;
  const netLatestMonth = revenueLatestMonth - costsLatestMonth;
  const netMarginPct =
    revenueLatestMonth > 0 ? Math.round((netLatestMonth / revenueLatestMonth) * 10000) / 100 : null;

  let revenueYtd = 0;
  let revenueYtdPriorYearSamePeriod = 0;
  for (const [mk, v] of financialByMonth) {
    const p = parseMonthKey(mk);
    if (!p) continue;
    if (p.y === ly && p.m >= 1 && p.m <= lm) revenueYtd += v.revenue;
    if (p.y === ly - 1 && p.m >= 1 && p.m <= lm) revenueYtdPriorYearSamePeriod += v.revenue;
  }

  const revenueYtdYoYPct = pctChange(revenueYtd, revenueYtdPriorYearSamePeriod);
  const revenueMomPct = pctChange(revenueLatestMonth, revenuePrevMonth);
  const costsMomPct = pctChange(costsLatestMonth, costsPrevMonth);

  const monthlySeries = monthKeys.map((mk) => {
    const s = seriesMap.get(mk)!;
    const net = s.revenue - s.costsTotal;
    return {
      monthKey: mk,
      label: `${mk.slice(5)}/${mk.slice(2, 4)}`,
      revenue: s.revenue,
      office: s.office,
      meeting: s.meeting,
      hotDesk: s.hotDesk,
      venue: s.venue,
      virtualOffice: s.virtualOffice,
      furniture: s.furniture,
      services: s.services,
      costsTotal: s.costsTotal,
      materialsServices: s.materialsServices,
      personnel: s.personnel,
      otherOperating: s.otherOperating,
      net,
    };
  });

  const { count: contractCount, error: cErr } = await supabase
    .from("room_contracts")
    .select("id", { count: "exact", head: true })
    .in("property_id", propertyIds)
    .eq("status", "active");
  if (cErr && cErr.code !== "42P01") {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  const activeContracts = cErr ? 0 : contractCount ?? 0;

  const occupancyByProperty: typeof emptyPayload.occupancyByProperty = [];
  let occTotal = 0;
  let occOccupied = 0;

  const { data: spaces, error: sErr } = await supabase
    .from("bookable_spaces")
    .select("id, property_id, space_status")
    .in("property_id", propertyIds)
    .in("space_status", ["occupied", "available"]);
  if (!sErr && spaces?.length) {
    const spaceRows = spaces as { id: string; property_id: string; space_status: string }[];
    for (const pid of propertyIds) {
      const subset = spaceRows.filter((sp) => sp.property_id === pid);
      const totalOffices = subset.length;
      const leasedOffices = subset.filter((sp) => sp.space_status === "occupied").length;
      occTotal += totalOffices;
      occOccupied += leasedOffices;
      const occ = totalOffices > 0 ? Math.round((leasedOffices / totalOffices) * 1000) / 10 : 0;
      occupancyByProperty.push({
        propertyId: pid,
        name: propertyList.find((p) => p.id === pid)?.name ?? "Property",
        occupancyPct: occ,
        leasedOffices,
        totalOffices,
      });
    }
  }

  const occupancyPct = occTotal > 0 ? Math.round((occOccupied / occTotal) * 1000) / 10 : 0;

  let openTasksCount = 0;
  let overdueOpenTasks = 0;
  if (ownerTenantIds.length > 0) {
    const baseTasks = supabase
      .from("client_tasks")
      .select("id", { count: "exact", head: true })
      .in("tenant_id", ownerTenantIds)
      .in("status", ["todo", "in_progress"])
      .or(propertyScopeOr);
    const { count: otc, error: otErr } = await baseTasks;
    if (otErr && otErr.code !== "42P01") {
      return NextResponse.json({ error: otErr.message }, { status: 500 });
    }
    openTasksCount = otErr ? 0 : otc ?? 0;

    const overdueQ = supabase
      .from("client_tasks")
      .select("id", { count: "exact", head: true })
      .in("tenant_id", ownerTenantIds)
      .in("status", ["todo", "in_progress"])
      .not("due_date", "is", null)
      .lt("due_date", today)
      .or(propertyScopeOr);
    const { count: odc, error: odErr } = await overdueQ;
    if (odErr && odErr.code !== "42P01") {
      return NextResponse.json({ error: odErr.message }, { status: 500 });
    }
    overdueOpenTasks = odErr ? 0 : odc ?? 0;
  }

  let pipelineValueEur = 0;
  if (ownerTenantIds.length > 0) {
    const { data: leadRows, error: lErr } = await supabase
      .from("leads")
      .select("approx_budget_eur_month, property_id")
      .in("tenant_id", ownerTenantIds)
      .eq("archived", false)
      .in("stage", ["new", "contacted", "viewing", "offer", "contract"])
      .or(propertyScopeOr);
    if (lErr && lErr.code !== "42P01") {
      return NextResponse.json({ error: lErr.message }, { status: 500 });
    }
    if (!lErr && leadRows?.length) {
      pipelineValueEur = (leadRows as { approx_budget_eur_month: unknown }[]).reduce(
        (s, r) => s + num(r.approx_budget_eur_month),
        0,
      );
    }
  }

  let recentActivities: typeof emptyPayload.recentActivities = [];
  if (ownerTenantIds.length > 0) {
    const { data: actRows, error: aErr } = await supabase
      .from("task_activities")
      .select("id, message, activity_type, created_at")
      .in("tenant_id", ownerTenantIds)
      .order("created_at", { ascending: false })
      .limit(8);
    if (!aErr && actRows?.length) {
      recentActivities = (actRows as { id: string; message: string | null; activity_type: string; created_at: string }[]).map(
        (a) => ({
          id: a.id,
          message: a.message,
          activityType: a.activity_type,
          createdAt: a.created_at,
        }),
      );
    }
  }

  let upcomingTasks: typeof emptyPayload.upcomingTasks = [];
  if (ownerTenantIds.length > 0) {
    const { data: taskRows, error: utErr } = await supabase
      .from("client_tasks")
      .select("id, title, due_date, status, property_id")
      .in("tenant_id", ownerTenantIds)
      .in("status", ["todo", "in_progress"])
      .or(propertyScopeOr)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(8);
    if (!utErr && taskRows?.length) {
      upcomingTasks = (taskRows as {
        id: string;
        title: string;
        due_date: string | null;
        status: string;
        property_id: string | null;
      }[]).map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.due_date,
        status: t.status,
        propertyId: t.property_id,
      }));
    }
  }

  return NextResponse.json({
    monthKeys,
    kpis: {
      latestMonthKey,
      revenueLatestMonth,
      revenuePrevMonth,
      revenueMomPct,
      costsLatestMonth,
      costsPrevMonth,
      costsMomPct,
      netLatestMonth,
      netMarginPct,
      revenueYtd,
      revenueYtdPriorYearSamePeriod,
      revenueYtdYoYPct,
      occupancyPct,
      activeContracts,
      openTasksCount,
      overdueOpenTasks,
      pipelineValueEur,
    },
    monthlySeries,
    occupancyByProperty,
    recentActivities,
    upcomingTasks,
  });
}
