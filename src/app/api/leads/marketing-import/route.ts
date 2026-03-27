import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ImportRow = {
  company_name?: string;
  contact_person_name?: string;
  email?: string;
  phone?: string;
  source?: string;
  property_id?: string | null;
  interested_space_type?: string | null;
  approx_size_m2?: number | null;
  approx_budget_eur_month?: number | null;
  preferred_move_in_date?: string | null;
  notes?: string | null;
};

type Body = {
  tenantId?: string;
  rows?: ImportRow[];
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tenantId = (body.tenantId ?? "").trim();
  const rows = body.rows ?? [];
  if (!tenantId) return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  if (!rows.length) return NextResponse.json({ error: "rows is required" }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, tenant_id")
    .eq("user_id", user.id);
  const canImport = (memberships ?? []).some((m) => {
    const role = (m.role ?? "").toLowerCase();
    return role === "super_admin" || (m.tenant_id === tenantId && (role === "owner" || role === "manager"));
  });
  if (!canImport) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const results: Array<{ rowNumber: number; success: boolean; error?: string; id?: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const company = (row.company_name ?? "").trim();
    const contact = (row.contact_person_name ?? "").trim();
    const email = (row.email ?? "").trim().toLowerCase();
    if (!company || !contact || !email) {
      results.push({ rowNumber: i + 1, success: false, error: "company_name, contact_person_name, email are required" });
      continue;
    }

    const insertRow = {
      tenant_id: tenantId,
      pipeline_owner: tenantId,
      property_id: row.property_id ?? null,
      company_name: company,
      contact_person_name: contact,
      email,
      phone: (row.phone ?? "").trim() || null,
      source: (row.source ?? "social_media").trim() || "social_media",
      interested_space_type: row.interested_space_type ?? null,
      approx_size_m2: row.approx_size_m2 ?? null,
      approx_budget_eur_month: row.approx_budget_eur_month ?? null,
      preferred_move_in_date: row.preferred_move_in_date ?? null,
      notes: row.notes ?? null,
      created_by_user_id: user.id,
    };
    const { data, error } = await supabase.from("leads").insert(insertRow).select("id").maybeSingle();
    if (error) {
      results.push({ rowNumber: i + 1, success: false, error: error.message });
    } else {
      results.push({ rowNumber: i + 1, success: true, id: data?.id as string | undefined });
    }
  }

  return NextResponse.json({ ok: true, results });
}

