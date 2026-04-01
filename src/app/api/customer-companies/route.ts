import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Body = {
  tenantId?: string;
  propertyId?: string | null;
  name?: string;
  businessId?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine?: string | null;
  city?: string | null;
  postalCode?: string | null;
  industry?: string | null;
  companySize?: string | null;
  spaceType?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  notes?: string | null;
  leadId?: string | null;
};

async function canManageTenant(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  tenantId: string,
): Promise<{ ok: boolean; superAdmin: boolean }> {
  const { data: mems } = await supabase.from("memberships").select("role, tenant_id").eq("user_id", userId);
  const rows = (mems ?? []) as { role: string | null; tenant_id: string | null }[];
  const roles = rows.map((m) => (m.role ?? "").toLowerCase());
  if (roles.includes("super_admin")) return { ok: true, superAdmin: true };
  const staff = rows.some(
    (m) => m.tenant_id === tenantId && ["owner", "manager"].includes((m.role ?? "").toLowerCase()),
  );
  return { ok: staff, superAdmin: false };
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  const tenantId = body.tenantId?.trim();
  if (!name || !tenantId) {
    return NextResponse.json({ error: "name and tenantId are required" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = await canManageTenant(supabase, user.id, tenantId);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const propertyId = body.propertyId?.trim() || null;
  if (propertyId) {
    const { data: prop } = await supabase.from("properties").select("id, tenant_id").eq("id", propertyId).maybeSingle();
    if (!prop || (prop as { tenant_id: string }).tenant_id !== tenantId) {
      return NextResponse.json({ error: "Property not found for this organization" }, { status: 400 });
    }
  }

  const insert = {
    tenant_id: tenantId,
    property_id: propertyId,
    name,
    business_id: body.businessId?.trim() || null,
    email: body.email?.trim() || null,
    phone: body.phone?.trim() || null,
    address_line: body.addressLine?.trim() || null,
    city: body.city?.trim() || null,
    postal_code: body.postalCode?.trim() || null,
    industry: body.industry?.trim() || null,
    company_size: body.companySize?.trim() || null,
    space_type: body.spaceType?.trim() || null,
    contract_start: body.contractStart?.trim() || null,
    contract_end: body.contractEnd?.trim() || null,
    notes: body.notes?.trim() || null,
  };

  const { data: company, error: insErr } = await supabase
    .from("customer_companies")
    .insert(insert as never)
    .select("id")
    .maybeSingle();

  if (insErr || !company) {
    return NextResponse.json({ error: insErr?.message ?? "Insert failed" }, { status: 400 });
  }

  const companyId = (company as { id: string }).id;
  const leadId = body.leadId?.trim();
  if (leadId) {
    const { data: lead } = await supabase.from("leads").select("id, tenant_id").eq("id", leadId).maybeSingle();
    const lr = lead as { id: string; tenant_id: string } | null;
    if (!lr || lr.tenant_id !== tenantId) {
      return NextResponse.json(
        { error: "Lead not found or tenant mismatch", companyId },
        { status: 400 },
      );
    }
    const { error: uErr } = await supabase.from("leads").update({ customer_company_id: companyId }).eq("id", leadId);
    if (uErr) {
      return NextResponse.json({ error: uErr.message, companyId }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, companyId });
}
