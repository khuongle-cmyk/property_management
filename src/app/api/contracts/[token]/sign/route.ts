import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createOnboardingTasksFromContract } from "@/lib/tasks/automation";

type Ctx = { params: Promise<{ token: string }> };

const CONTRACT_SELECT_PUBLIC =
  "id,title,status,signing_method,is_template,public_token,customer_name,customer_company,company_id,property_id,space_details,monthly_price,contract_length_months,start_date,intro_text,terms_text,signed_at";

/** Public: load contract tool row by share token (no auth). */
export async function GET(_req: Request, context: Ctx) {
  try {
    const { token: raw } = await context.params;
    const token = decodeURIComponent(raw ?? "").trim();
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const { data: contract, error } = await admin
      .from("contracts")
      .select(CONTRACT_SELECT_PUBLIC)
      .eq("public_token", token)
      .eq("is_template", false)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

    let companyName: string | null = null;
    if (contract.company_id) {
      const { data: lead } = await admin.from("leads").select("company_name").eq("id", contract.company_id).maybeSingle();
      companyName = lead?.company_name ?? null;
    }

    let property: { name: string | null; address: string | null; city: string | null } | null = null;
    if (contract.property_id) {
      const { data: p } = await admin.from("properties").select("name,address,city").eq("id", contract.property_id).maybeSingle();
      property = p ?? null;
    }

    return NextResponse.json({ contract, property, companyName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    if (msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Public: record e-sign acceptance by share token (no auth). */
export async function POST(_req: Request, context: Ctx) {
  try {
    const { token: raw } = await context.params;
    const token = decodeURIComponent(raw ?? "").trim();
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const { data: row, error: qErr } = await admin
      .from("contracts")
      .select("id,status,signing_method,is_template,signed_at")
      .eq("public_token", token)
      .eq("is_template", false)
      .maybeSingle();

    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
    if (!row) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

    if (row.signing_method !== "esign") {
      return NextResponse.json({ error: "This contract is not set up for e-sign" }, { status: 400 });
    }

    if (row.status === "signed_digital" || row.status === "signed_paper" || row.status === "active") {
      return NextResponse.json({ ok: true, alreadySigned: true });
    }

    if (row.status !== "sent" && row.status !== "draft") {
      return NextResponse.json({ error: "This contract is not available for signing yet" }, { status: 400 });
    }

    const update: Record<string, unknown> = {
      status: "signed_digital",
      signed_at: new Date().toISOString(),
    };

    const { error: uErr } = await admin.from("contracts").update(update).eq("id", row.id);
    if (uErr) {
      const hint =
        uErr.message?.includes("signed_at") || uErr.message?.includes("column")
          ? "Add column signed_at to public.contracts (see sql/contracts_public_signing.sql)."
          : undefined;
      return NextResponse.json({ error: uErr.message, hint }, { status: 500 });
    }

    const contract = row;
    const { data: contractForLead } = await admin
      .from("contracts")
      .select("lead_id, company_id")
      .eq("id", contract.id)
      .maybeSingle();
    const leadIdToWin = contractForLead?.lead_id || contractForLead?.company_id;
    if (leadIdToWin) {
      const now = new Date().toISOString();
      const { error: leadErr } = await admin
        .from("leads")
        .update({
          stage: "won",
          stage_changed_at: now,
          won_at: now,
          lost_reason: null,
          archived: false,
        })
        .eq("id", leadIdToWin);
      if (leadErr) {
        console.error("Error moving lead to won after contract sign:", leadErr);
      }
    }

    // Create onboarding tasks from the signed contract
    try {
      // Get the full contract data for task creation
      const { data: fullContract } = await admin
        .from("contracts")
        .select("id, tenant_id, lead_id, company_id, property_id, start_date")
        .eq("id", contract.id)
        .single();

      if (fullContract && fullContract.tenant_id && fullContract.property_id) {
        await createOnboardingTasksFromContract({
          supabase: admin,
          contractId: fullContract.id,
          tenantId: fullContract.tenant_id,
          leadId: fullContract.lead_id || fullContract.company_id || null,
          propertyId: fullContract.property_id,
          roomId: null,
          contractStartDate: fullContract.start_date || new Date().toISOString().slice(0, 10),
        });
      }
    } catch (taskErr) {
      console.error("Error creating onboarding tasks:", taskErr);
      // Don't fail the signing if task creation fails
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    if (msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
