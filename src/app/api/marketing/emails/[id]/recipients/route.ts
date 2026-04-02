import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  canAccessMarketingRowByTenantId,
  getMarketingAccess,
  marketingLeadTenantIdsForEmail,
} from "@/lib/marketing/access";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getMarketingAccess(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: emailId } = await ctx.params;
  if (!emailId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: em, error: eErr } = await supabase.from("marketing_emails").select("tenant_id, status").eq("id", emailId).maybeSingle();
  if (eErr || !em) return NextResponse.json({ error: "Email not found" }, { status: 404 });
  const tenantId = (em as { tenant_id: string | null }).tenant_id;
  if (!canAccessMarketingRowByTenantId(tenantId, { tenantIds, isSuperAdmin })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const leadTenantIds = await marketingLeadTenantIdsForEmail(supabase, tenantId, { tenantIds, isSuperAdmin });
  if (leadTenantIds.length === 0) {
    return NextResponse.json({ error: "No tenant scope for recipients" }, { status: 400 });
  }
  if ((em as { status: string }).status !== "draft") {
    return NextResponse.json({ error: "Recipients locked after send" }, { status: 400 });
  }

  let body: {
    audience?: string;
    emails?: string[];
    space_type?: string;
    property_id?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const audience = String(body.audience ?? "all_leads");
  const rows: { email_id: string; contact_id: string | null; email_address: string; tracking_token: string }[] = [];

  function pushLeads(leads: { id: string; email: string | null }[] | null) {
    const seen = new Set<string>();
    for (const L of leads ?? []) {
      const r = L as { id: string; email: string | null };
      const addr = (r.email ?? "").trim().toLowerCase();
      if (!addr || seen.has(addr)) continue;
      seen.add(addr);
      rows.push({
        email_id: emailId,
        contact_id: r.id,
        email_address: addr,
        tracking_token: randomUUID(),
      });
    }
  }

  if (audience === "custom_list") {
    const list = (body.emails ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
    const seen = new Set<string>();
    for (const addr of list) {
      if (seen.has(addr)) continue;
      seen.add(addr);
      rows.push({ email_id: emailId, contact_id: null, email_address: addr, tracking_token: randomUUID() });
    }
  } else if (audience === "all_leads") {
    let lq = supabase
      .from("leads")
      .select("id, email")
      .eq("email_unsubscribed", false)
      .eq("archived", false)
      .not("email", "is", null);
    lq = leadTenantIds.length === 1 ? lq.eq("tenant_id", leadTenantIds[0]) : lq.in("tenant_id", leadTenantIds);
    const { data: leads, error: lErr } = await lq;
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
    pushLeads(leads as { id: string; email: string }[]);
  } else if (audience === "all_tenants") {
    let lq = supabase
      .from("leads")
      .select("id, email")
      .eq("stage", "won")
      .eq("email_unsubscribed", false)
      .not("email", "is", null);
    lq = leadTenantIds.length === 1 ? lq.eq("tenant_id", leadTenantIds[0]) : lq.in("tenant_id", leadTenantIds);
    const { data: leads, error: lErr } = await lq;
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
    pushLeads(leads as { id: string; email: string }[]);
  } else if (audience === "all_contacts") {
    let lq = supabase
      .from("leads")
      .select("id, email")
      .eq("email_unsubscribed", false)
      .eq("archived", false)
      .not("email", "is", null);
    lq = leadTenantIds.length === 1 ? lq.eq("tenant_id", leadTenantIds[0]) : lq.in("tenant_id", leadTenantIds);
    const { data: leads, error: lErr } = await lq;
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
    pushLeads(leads as { id: string; email: string }[]);
  } else if (audience === "by_space_type") {
    const st = String(body.space_type ?? "").trim();
    if (!st) return NextResponse.json({ error: "space_type required" }, { status: 400 });
    let lq = supabase
      .from("leads")
      .select("id, email")
      .eq("email_unsubscribed", false)
      .eq("archived", false)
      .ilike("interested_space_type", `%${st}%`)
      .not("email", "is", null);
    lq = leadTenantIds.length === 1 ? lq.eq("tenant_id", leadTenantIds[0]) : lq.in("tenant_id", leadTenantIds);
    const { data: leads, error: lErr } = await lq;
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
    pushLeads(leads as { id: string; email: string }[]);
  } else if (audience === "by_property") {
    const pid = String(body.property_id ?? "").trim();
    if (!pid) return NextResponse.json({ error: "property_id required" }, { status: 400 });
    let lq = supabase
      .from("leads")
      .select("id, email")
      .eq("property_id", pid)
      .eq("email_unsubscribed", false)
      .eq("archived", false)
      .not("email", "is", null);
    lq = leadTenantIds.length === 1 ? lq.eq("tenant_id", leadTenantIds[0]) : lq.in("tenant_id", leadTenantIds);
    const { data: leads, error: lErr } = await lq;
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
    pushLeads(leads as { id: string; email: string }[]);
  } else {
    return NextResponse.json(
      { error: "Unsupported audience" },
      { status: 400 },
    );
  }

  await supabase.from("marketing_email_recipients").delete().eq("email_id", emailId);
  if (rows.length) {
    const { error: iErr } = await supabase.from("marketing_email_recipients").insert(rows);
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  }

  await supabase.from("marketing_emails").update({ recipient_count: rows.length }).eq("id", emailId);

  return NextResponse.json({ ok: true, count: rows.length });
}
