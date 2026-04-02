import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getMarketingAccess,
  marketingResponseTenantKey,
  marketingScopeTenantIds,
  resolveMarketingTenantScope,
} from "@/lib/marketing/access";

function monthStartUtc(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function monthEndUtc(d = new Date()): string {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return next.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getMarketingAccess(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const resolved = await resolveMarketingTenantScope(supabase, url, { tenantIds, isSuperAdmin });
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const scopeIds = marketingScopeTenantIds(resolved.scope);
  const tenantKey = marketingResponseTenantKey(resolved.scope);

  const monthParam = url.searchParams.get("month")?.trim();
  let refDate = new Date();
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [yy, mm] = monthParam.split("-").map(Number);
    refDate = new Date(Date.UTC(yy, (mm ?? 1) - 1, 1));
  }
  const start = monthStartUtc(refDate);
  const end = monthEndUtc(refDate);
  const y = refDate.getUTCFullYear();
  const m = refDate.getUTCMonth() + 1;
  const monthPrefix = `${y}-${String(m).padStart(2, "0")}`;

  if (scopeIds.length === 0) {
    return NextResponse.json({
      tenantId: tenantKey,
      monthRange: { start, end },
      kpis: {
        acquisition: {
          websiteVisitors: 0,
          newLeads: 0,
          leadConversionPct: null,
          costPerLead: null,
        },
        conversion: {
          leadToTenantPct: null,
          newTenantsMonth: 0,
          avgConvertDays: null,
          revenueAttributed: 0,
        },
        campaigns: {
          activeCampaigns: 0,
          emailsSentMonth: 0,
          avgOpenRatePct: null,
          smsDeliveryPct: null,
        },
      },
      charts: {
        funnel: [],
        revenueByChannel: {},
        campaignPerformance: [],
        revenueTrend: [],
        events: [],
      },
    });
  }

  const db = supabase as any;
  const tenantScope = (q: any) => (scopeIds.length === 1 ? q.eq("tenant_id", scopeIds[0]) : q.in("tenant_id", scopeIds));

  const { data: props } = await tenantScope(db.from("properties").select("id"));
  const propertyIds = ((props ?? []) as { id: string }[]).map((p) => p.id);

  let visitorsMonth = 0;
  let leadsAggMonth = 0;
  let bookingsAggMonth = 0;
  let adSpendMonth = 0;
  let revenueAttrMonth = 0;

  const { data: maRows } = (await tenantScope(
    db
      .from("marketing_analytics")
      .select("website_visitors,new_leads,bookings_made,ad_spend,revenue_attributed")
      .gte("date", start)
      .lte("date", end),
  )) as { data: unknown[] | null };

  for (const r of maRows ?? []) {
    visitorsMonth += Number((r as { website_visitors: number }).website_visitors) || 0;
    leadsAggMonth += Number((r as { new_leads: number }).new_leads) || 0;
    bookingsAggMonth += Number((r as { bookings_made: number }).bookings_made) || 0;
    adSpendMonth += Number((r as { ad_spend: number }).ad_spend) || 0;
    revenueAttrMonth += Number((r as { revenue_attributed: number }).revenue_attributed) || 0;
  }

  const { count: leadCount } = (await tenantScope(
    db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", `${start}T00:00:00.000Z`)
      .lte("created_at", `${end}T23:59:59.999Z`),
  )) as { count: number | null };
  const newLeadsFromCrm = leadCount ?? 0;
  const newLeads = Math.max(newLeadsFromCrm, leadsAggMonth);

  const { count: wonCount } = (await tenantScope(
    db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("stage", "won")
      .not("won_at", "is", null)
      .gte("won_at", `${start}T00:00:00.000Z`)
      .lte("won_at", `${end}T23:59:59.999Z`),
  )) as { count: number | null };
  const newTenantsMonth = wonCount ?? 0;

  const { data: wonLeads } = (await tenantScope(
    db
      .from("leads")
      .select("created_at, won_at")
      .eq("stage", "won")
      .not("won_at", "is", null)
      .gte("won_at", `${start}T00:00:00.000Z`)
      .lte("won_at", `${end}T23:59:59.999Z`)
      .limit(500),
  )) as { data: unknown[] | null };

  let sumConvertDays = 0;
  let convertN = 0;
  for (const row of wonLeads ?? []) {
    const w = row as { created_at: string; won_at: string };
    const c = new Date(w.created_at).getTime();
    const x = new Date(w.won_at).getTime();
    if (Number.isFinite(c) && Number.isFinite(x) && x >= c) {
      sumConvertDays += (x - c) / 86400000;
      convertN += 1;
    }
  }
  const avgConvertDays = convertN > 0 ? Math.round((sumConvertDays / convertN) * 10) / 10 : null;

  const visitorsForRate = visitorsMonth > 0 ? visitorsMonth : 0;
  const leadConversionPct =
    visitorsForRate > 0 && newLeads > 0 ? Math.round((newLeads / visitorsForRate) * 10000) / 100 : null;
  const costPerLead =
    adSpendMonth > 0 && newLeads > 0 ? Math.round((adSpendMonth / newLeads) * 100) / 100 : null;

  const leadToTenantPct =
    newLeads > 0 && newTenantsMonth > 0 ? Math.round((newTenantsMonth / newLeads) * 10000) / 100 : null;

  const { count: ac } = (await tenantScope(
    db
      .from("marketing_campaigns")
      .select("id", { count: "exact", head: true })
      .in("status", ["active", "scheduled"]),
  )) as { count: number | null };
  const activeCampaigns = ac ?? 0;

  let emailsSentMonth = 0;
  let openSum = 0;
  let openDenom = 0;
  const { data: emailRows } = (await tenantScope(
    supabase
      .from("marketing_emails")
      .select("recipient_count, open_count, status, sent_at")
      .eq("status", "sent")
      .gte("sent_at", `${start}T00:00:00.000Z`)
      .lte("sent_at", `${end}T23:59:59.999Z`),
  )) as { data: unknown[] | null };
  for (const e of emailRows ?? []) {
    const row = e as { recipient_count: number; open_count: number };
    emailsSentMonth += Number(row.recipient_count) || 0;
    const rc = Number(row.recipient_count) || 0;
    const oc = Number(row.open_count) || 0;
    if (rc > 0) {
      openSum += oc / rc;
      openDenom += 1;
    }
  }
  const avgOpenRatePct = openDenom > 0 ? Math.round((openSum / openDenom) * 10000) / 100 : null;

  let smsDelivered = 0;
  let smsAttempted = 0;
  const { data: smsRows } = (await tenantScope(
    db
      .from("marketing_sms")
      .select("delivered_count, recipient_count, status, sent_at")
      .eq("status", "sent")
      .gte("sent_at", `${start}T00:00:00.000Z`)
      .lte("sent_at", `${end}T23:59:59.999Z`),
  )) as { data: unknown[] | null };
  for (const s of smsRows ?? []) {
    const row = s as { delivered_count: number; recipient_count: number };
    smsDelivered += Number(row.delivered_count) || 0;
    smsAttempted += Number(row.recipient_count) || 0;
  }
  const smsDeliveryPct =
    smsAttempted > 0 ? Math.round((smsDelivered / smsAttempted) * 10000) / 100 : null;

  const { data: funnelRowsRaw } = (await tenantScope(
    supabase
      .from("marketing_analytics")
      .select("date, website_visitors, new_leads, bookings_made")
      .gte("date", `${monthPrefix}-01`)
      .order("date", { ascending: true })
      .limit(scopeIds.length > 1 ? 2000 : 62),
  )) as { data: unknown[] | null };

  const funnelByDate = new Map<string, { visitors: number; leads: number; bookings: number }>();
  for (const r of funnelRowsRaw ?? []) {
    const x = r as { date: string; website_visitors: number; new_leads: number; bookings_made: number };
    const cur = funnelByDate.get(x.date) ?? { visitors: 0, leads: 0, bookings: 0 };
    cur.visitors += Number(x.website_visitors) || 0;
    cur.leads += Number(x.new_leads) || 0;
    cur.bookings += Number(x.bookings_made) || 0;
    funnelByDate.set(x.date, cur);
  }
  const funnel = [...funnelByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      visitors: v.visitors,
      leads: v.leads,
      bookings: v.bookings,
    }));

  const { data: channelRows } = (await tenantScope(
    db
      .from("marketing_analytics")
      .select("source, revenue_attributed")
      .gte("date", start)
      .lte("date", end),
  )) as { data: unknown[] | null };
  const revenueByChannel: Record<string, number> = {};
  for (const r of channelRows ?? []) {
    const x = r as { source: string; revenue_attributed: number };
    revenueByChannel[x.source] = (revenueByChannel[x.source] ?? 0) + (Number(x.revenue_attributed) || 0);
  }

  const { data: campPerf } = (await tenantScope(
    db
      .from("marketing_campaigns")
      .select("id, name, status, actual_spend, campaign_type")
      .order("updated_at", { ascending: false })
      .limit(12),
  )) as { data: unknown[] | null };

  let revenueTrend: { monthKey: string; revenue: number }[] = [];
  if (propertyIds.length > 0) {
    const { data: hr } = await supabase
      .from("historical_revenue")
      .select("year, month, total_revenue")
      .in("property_id", propertyIds)
      .gte("year", y - 1)
      .limit(4000);
    const byMonth = new Map<string, number>();
    for (const row of hr ?? []) {
      const r = row as { year: number; month: number; total_revenue: unknown };
      const mk = `${r.year}-${String(r.month).padStart(2, "0")}`;
      const add = Number(r.total_revenue) || 0;
      byMonth.set(mk, (byMonth.get(mk) ?? 0) + add);
    }
    revenueTrend = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([monthKey, revenue]) => ({ monthKey, revenue }));
  }

  const { data: eventMarks } = (await tenantScope(
    db
      .from("marketing_events")
      .select("start_datetime, name")
      .eq("status", "published")
      .gte("start_datetime", `${y - 1}-01-01`)
      .order("start_datetime", { ascending: true })
      .limit(24),
  )) as { data: unknown[] | null };

  return NextResponse.json({
    tenantId: tenantKey,
    monthRange: { start, end },
    kpis: {
      acquisition: {
        websiteVisitors: visitorsMonth,
        newLeads,
        leadConversionPct,
        costPerLead,
      },
      conversion: {
        leadToTenantPct,
        newTenantsMonth,
        avgConvertDays,
        revenueAttributed: revenueAttrMonth,
      },
      campaigns: {
        activeCampaigns,
        emailsSentMonth,
        avgOpenRatePct,
        smsDeliveryPct,
      },
    },
    charts: {
      funnel,
      revenueByChannel,
      campaignPerformance: campPerf ?? [],
      revenueTrend,
      events: eventMarks ?? [],
    },
  });
}
