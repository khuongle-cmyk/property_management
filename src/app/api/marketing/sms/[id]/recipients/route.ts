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

  const { id: smsId } = await ctx.params;
  if (!smsId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: smsRow, error: sErr } = await supabase.from("marketing_sms").select("tenant_id, status").eq("id", smsId).maybeSingle();
  if (sErr || !smsRow) return NextResponse.json({ error: "SMS not found" }, { status: 404 });
  const tenantId = (smsRow as { tenant_id: string | null }).tenant_id;
  if (!canAccessMarketingRowByTenantId(tenantId, { tenantIds, isSuperAdmin })) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const leadTenantIds = await marketingLeadTenantIdsForEmail(supabase, tenantId, { tenantIds, isSuperAdmin });
  if (leadTenantIds.length === 0) {
    return NextResponse.json({ error: "No tenant scope for recipients" }, { status: 400 });
  }
  if ((smsRow as { status: string }).status !== "draft") {
    return NextResponse.json({ error: "Recipients locked after send" }, { status: 400 });
  }

  let body: { audience?: string; phones?: string[]; space_type?: string; property_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const audience = String(body.audience ?? "all_leads");
  const rows: { sms_id: string; contact_id: string | null; phone_number: string }[] = [];

  function pushPhones(leads: { id: string; phone: string | null }[] | null) {
    const seen = new Set<string>();
    for (const L of leads ?? []) {
      const r = L as { id: string; phone: string | null };
      const raw = (r.phone ?? "").replace(/\s/g, "");
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      rows.push({ sms_id: smsId, contact_id: r.id, phone_number: raw });
    }
  }

  if (audience === "custom_list") {
    const seen = new Set<string>();
    for (const p of body.phones ?? []) {
      const raw = String(p).replace(/\s/g, "");
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      rows.push({ sms_id: smsId, contact_id: null, phone_number: raw });
    }
  } else {
    let q = supabase
      .from("leads")
      .select("id, phone")
      .eq("phone_unsubscribed", false)
      .eq("archived", false)
      .not("phone", "is", null);
    q = leadTenantIds.length === 1 ? q.eq("tenant_id", leadTenantIds[0]) : q.in("tenant_id", leadTenantIds);

    if (audience === "all_tenants") q = q.eq("stage", "won");
    else if (audience === "by_space_type") {
      const st = String(body.space_type ?? "").trim();
      if (!st) return NextResponse.json({ error: "space_type required" }, { status: 400 });
      q = q.ilike("interested_space_type", `%${st}%`);
    } else if (audience === "by_property") {
      const pid = String(body.property_id ?? "").trim();
      if (!pid) return NextResponse.json({ error: "property_id required" }, { status: 400 });
      q = q.eq("property_id", pid);
    } else if (audience !== "all_leads" && audience !== "all_contacts") {
      return NextResponse.json({ error: "Unsupported audience" }, { status: 400 });
    }

    const { data: leads, error: lErr } = await q;
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
    pushPhones(leads as { id: string; phone: string }[]);
  }

  await supabase.from("marketing_sms_recipients").delete().eq("sms_id", smsId);
  if (rows.length) {
    const { error: iErr } = await supabase.from("marketing_sms_recipients").insert(rows);
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  }

  await supabase.from("marketing_sms").update({ recipient_count: rows.length }).eq("id", smsId);

  return NextResponse.json({ ok: true, count: rows.length });
}
