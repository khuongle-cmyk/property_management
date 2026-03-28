import { NextResponse } from "next/server";
import { resolveContactPersonName } from "@/lib/crm/finnish-company";
import { leadCompanyFieldsFromBody } from "@/lib/crm/lead-company-payload";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeLeadSource, normalizeSpaceType } from "@/lib/crm/lead-import-parse";

type ImportBodyRow = Record<string, unknown> & {
  company_name?: string;
  contact_person_name?: string;
  contact_name?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  contact_title?: string;
  contact_direct_phone?: string | null;
  email?: string;
  phone?: string | null;
  source?: string;
  interested_property?: string | null;
  property_id?: string | null;
  interested_space_type?: string | null;
  space_type?: string | null;
  approx_size_m2?: number | string | null;
  size_m2?: number | string | null;
  approx_budget_eur_month?: number | string | null;
  budget_month?: number | string | null;
  preferred_move_in_date?: string | null;
  move_in_date?: string | null;
  notes?: string | null;
  business_id?: string | null;
  vat_number?: string | null;
  company_type?: string | null;
  industry_sector?: string | null;
  company_size?: string | null;
  company_website?: string | null;
  billing_street?: string | null;
  billing_postal_code?: string | null;
  billing_city?: string | null;
  billing_email?: string | null;
  e_invoice_address?: string | null;
  e_invoice_operator_code?: string | null;
};

type Body = {
  tenantId?: string;
  duplicateMode?: "skip" | "update" | "error";
  rows?: ImportBodyRow[];
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolvePropertyId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  raw: string | null | undefined
): Promise<string | null> {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (UUID_RE.test(t)) {
    const { data } = await supabase.from("properties").select("id").eq("id", t).eq("tenant_id", tenantId).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }
  const { data: exact } = await supabase
    .from("properties")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", t)
    .maybeSingle();
  if (exact?.id) return exact.id as string;
  const { data: near } = await supabase
    .from("properties")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", `%${t}%`)
    .limit(1)
    .maybeSingle();
  return (near?.id as string | undefined) ?? null;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tenantId = (body.tenantId ?? "").trim();
  const duplicateMode = body.duplicateMode ?? "error";
  const rows = body.rows ?? [];
  if (!tenantId) return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  if (!rows.length) return NextResponse.json({ error: "rows is required" }, { status: 400 });
  if (!["skip", "update", "error"].includes(duplicateMode)) {
    return NextResponse.json({ error: "duplicateMode must be skip, update, or error" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: memberships } = await supabase.from("memberships").select("role, tenant_id").eq("user_id", user.id);
  const canImport = (memberships ?? []).some((m) => {
    const role = (m.role ?? "").toLowerCase();
    return role === "super_admin" || (m.tenant_id === tenantId && (role === "owner" || role === "manager"));
  });
  if (!canImport) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const results: Array<{
    rowNumber: number;
    success: boolean;
    action?: "inserted" | "updated" | "skipped";
    error?: string;
    id?: string;
  }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const company = (row.company_name ?? "").trim();
    const contact = resolveContactPersonName({
      contact_person_name: row.contact_person_name ?? row.contact_name,
      contact_first_name: row.contact_first_name,
      contact_last_name: row.contact_last_name,
    }).trim();
    const email = (row.email ?? "").trim().toLowerCase();
    if (!company || !contact || !email) {
      results.push({
        rowNumber: i + 1,
        success: false,
        error: "company_name, contact_name, email are required",
      });
      continue;
    }

    let propertyId = (row.property_id as string | null | undefined) ?? null;
    propertyId = propertyId && propertyId.trim() ? propertyId.trim() : null;
    if (!propertyId && row.interested_property) {
      propertyId = await resolvePropertyId(supabase, tenantId, row.interested_property);
      if ((row.interested_property ?? "").trim() && !propertyId) {
        results.push({
          rowNumber: i + 1,
          success: false,
          error: `Property not found for "${(row.interested_property ?? "").trim()}"`,
        });
        continue;
      }
    }

    const spaceRaw = row.interested_space_type ?? row.space_type;
    const spaceType = normalizeSpaceType(spaceRaw ?? undefined);

    const companyCols = leadCompanyFieldsFromBody(row as Record<string, unknown>);

    const insertBase = {
      tenant_id: tenantId,
      pipeline_owner: tenantId,
      property_id: propertyId,
      company_name: company,
      contact_person_name: contact,
      email,
      phone: (row.phone ?? "").toString().trim() || null,
      source: normalizeLeadSource(row.source as string | undefined),
      interested_space_type: spaceType,
      approx_size_m2: numOrNull(row.approx_size_m2 ?? row.size_m2),
      approx_budget_eur_month: numOrNull(row.approx_budget_eur_month ?? row.budget_month),
      preferred_move_in_date: (row.preferred_move_in_date ?? row.move_in_date ?? "").toString().trim() || null,
      notes: row.notes != null && String(row.notes).trim() ? String(row.notes).trim() : null,
      created_by_user_id: user.id,
      assigned_agent_user_id: user.id,
      ...companyCols,
    };

    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("email", email)
      .maybeSingle();

    if (existing?.id) {
      if (duplicateMode === "skip") {
        results.push({ rowNumber: i + 1, success: true, action: "skipped", id: existing.id as string });
        continue;
      }
      if (duplicateMode === "error") {
        results.push({ rowNumber: i + 1, success: false, error: "Duplicate email (use skip or update)" });
        continue;
      }
      const { created_by_user_id: _cb, ...updatePayload } = insertBase;
      void _cb;
      const { error: uErr } = await supabase.from("leads").update(updatePayload).eq("id", existing.id as string);
      if (uErr) {
        results.push({ rowNumber: i + 1, success: false, error: uErr.message });
      } else {
        results.push({ rowNumber: i + 1, success: true, action: "updated", id: existing.id as string });
      }
      continue;
    }

    const { data, error } = await supabase
      .from("leads")
      .insert({
        ...insertBase,
        stage: "new",
      })
      .select("id")
      .maybeSingle();
    if (error) {
      results.push({ rowNumber: i + 1, success: false, error: error.message });
    } else {
      results.push({ rowNumber: i + 1, success: true, action: "inserted", id: data?.id as string | undefined });
    }
  }

  return NextResponse.json({ ok: true, results });
}
