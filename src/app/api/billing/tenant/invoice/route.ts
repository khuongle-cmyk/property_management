import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { brandEmailFrom, resolveBrandByTenantId } from "@/lib/brand/server";
import { canManageTenant, getMembershipScope } from "@/lib/billing/access";
import { computePricingBreakdown, countTenantUsage, loadPlan, monthStartIso } from "@/lib/billing/pricing";
import { Resend } from "resend";

function nextInvoiceNumber(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const rnd = Math.floor(Math.random() * 9000 + 1000);
  return `INV-${y}${m}-${rnd}`;
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const scope = await getMembershipScope(supabase);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json()) as { tenantId?: string; billingMonth?: string; dueDate?: string; notes?: string; recipientEmail?: string; action?: "create" | "send" };
  const tenantId = String(body.tenantId ?? "").trim();
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  if (!canManageTenant(scope, tenantId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const billingMonth = (body.billingMonth ?? monthStartIso()).slice(0, 10);
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id,name,plan,trial_status,trial_ends_at,contact_email")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  const planId = String((tenant as { plan?: string }).plan ?? "starter");
  const plan = await loadPlan(supabase, planId);
  if (!plan) return NextResponse.json({ error: "Pricing plan missing" }, { status: 500 });
  const usage = await countTenantUsage(supabase, tenantId);
  const trialEndsAt = String((tenant as { trial_ends_at?: string | null }).trial_ends_at ?? "");
  const trialStatus = String((tenant as { trial_status?: string | null }).trial_status ?? "none");
  const inTrial = trialStatus === "active" && !!trialEndsAt && trialEndsAt > new Date().toISOString();
  const breakdown = computePricingBreakdown({
    plan,
    activeProperties: usage.properties,
    activeUsers: usage.users,
    billingMonth,
    inTrial,
  });
  const billingMonthPrefix = billingMonth.slice(0, 7);

  const [{ data: virtualOfficeRows }, { data: furnitureRows }] = await Promise.all([
    supabase
      .from("virtual_office_contracts")
      .select("id,property_id,monthly_fee,status,start_date,end_date")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .lte("start_date", `${billingMonthPrefix}-31`)
      .or(`end_date.is.null,end_date.gte.${billingMonth}`),
    supabase
      .from("furniture_rentals")
      .select("id,rental_type,monthly_fee,sale_price,start_date,end_date,status")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .lte("start_date", `${billingMonthPrefix}-31`)
      .or(`end_date.is.null,end_date.gte.${billingMonth}`),
  ]);

  const virtualOfficeSubtotal = (virtualOfficeRows ?? []).reduce(
    (sum, r) => sum + Number((r as { monthly_fee?: number }).monthly_fee ?? 0),
    0,
  );
  const furnitureRecurringSubtotal = (furnitureRows ?? [])
    .filter((r) => (r as { rental_type?: string }).rental_type === "extra_rental")
    .reduce((sum, r) => sum + Number((r as { monthly_fee?: number }).monthly_fee ?? 0), 0);
  const furnitureSalesSubtotal = (furnitureRows ?? [])
    .filter(
      (r) =>
        (r as { rental_type?: string }).rental_type === "sold" &&
        String((r as { start_date?: string }).start_date ?? "").slice(0, 7) === billingMonthPrefix,
    )
    .reduce((sum, r) => sum + Number((r as { sale_price?: number }).sale_price ?? 0), 0);
  const extraSubtotal = virtualOfficeSubtotal + furnitureRecurringSubtotal + furnitureSalesSubtotal;
  const extraTax = Number((extraSubtotal * 0.255).toFixed(2));
  const subtotal = Number((breakdown.subtotal + extraSubtotal).toFixed(2));
  const taxAmount = Number((breakdown.taxAmount + extraTax).toFixed(2));
  const totalAmount = Number((subtotal + taxAmount).toFixed(2));

  const dueDate = (body.dueDate ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)).slice(0, 10);
  const recipientEmail = (body.recipientEmail ?? (tenant as { contact_email?: string | null }).contact_email ?? "").trim() || null;
  const brand = await resolveBrandByTenantId(tenantId);
  const invoiceNumber = nextInvoiceNumber();

  const { data: invoice, error } = await supabase
    .from("manual_billing_invoices")
    .insert({
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      billing_month: billingMonth,
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: dueDate,
      recipient_name: (tenant as { name?: string | null }).name ?? null,
      recipient_email: recipientEmail,
      sender_name: brand.email_sender_name ?? brand.brand_name,
      sender_email: brand.email_sender_address ?? null,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      notes: body.notes ?? null,
      created_by: scope.userId,
    })
    .select("*")
    .maybeSingle();
  if (error || !invoice) return NextResponse.json({ error: error?.message ?? "Could not create invoice" }, { status: 500 });

  const itemRows = breakdown.lineItems
    .filter((x) => x.amount > 0)
    .map((x) => ({
      invoice_id: (invoice as { id: string }).id,
      item_type: x.key === "base" ? "plan" : x.key === "prop" ? "property_overage" : "user_overage",
      description: x.label,
      quantity: x.qty,
      unit_price: x.unitPrice,
      amount: x.amount,
      metadata: {},
    }));
  if (breakdown.trialCreditAmount > 0) {
    itemRows.push({
      invoice_id: (invoice as { id: string }).id,
      item_type: "trial_credit",
      description: "Trial credit",
      quantity: 1,
      unit_price: -breakdown.trialCreditAmount,
      amount: -breakdown.trialCreditAmount,
      metadata: {},
    });
  }
  for (const row of virtualOfficeRows ?? []) {
    itemRows.push({
      invoice_id: (invoice as { id: string }).id,
      item_type: "manual",
      description: `Virtuaalitoimisto - ${String((row as { property_id?: string }).property_id ?? "").slice(0, 8)}`,
      quantity: 1,
      unit_price: Number((row as { monthly_fee?: number }).monthly_fee ?? 0),
      amount: Number((row as { monthly_fee?: number }).monthly_fee ?? 0),
      metadata: { virtual_office_contract_id: (row as { id: string }).id },
    });
  }
  for (const row of furnitureRows ?? []) {
    const rentalType = String((row as { rental_type?: string }).rental_type ?? "");
    if (rentalType === "extra_rental") {
      const amount = Number((row as { monthly_fee?: number }).monthly_fee ?? 0);
      itemRows.push({
        invoice_id: (invoice as { id: string }).id,
        item_type: "manual",
        description: "Kalusteet",
        quantity: 1,
        unit_price: amount,
        amount,
        metadata: { furniture_rental_id: (row as { id: string }).id, rental_type: rentalType },
      });
    } else if (
      rentalType === "sold" &&
      String((row as { start_date?: string }).start_date ?? "").slice(0, 7) === billingMonthPrefix
    ) {
      const amount = Number((row as { sale_price?: number }).sale_price ?? 0);
      itemRows.push({
        invoice_id: (invoice as { id: string }).id,
        item_type: "manual",
        description: "Kalusteet (kertamyynti)",
        quantity: 1,
        unit_price: amount,
        amount,
        metadata: { furniture_rental_id: (row as { id: string }).id, rental_type: rentalType },
      });
      await supabase.from("furniture_rentals").update({ status: "ended" }).eq("id", (row as { id: string }).id);
    }
  }
  if (itemRows.length) {
    const { error: iErr } = await supabase.from("manual_billing_invoice_items").insert(itemRows);
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  }

  if (body.action === "send") {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return NextResponse.json({ error: "RESEND_API_KEY missing; invoice created as draft", invoice }, { status: 503 });
    }
    if (!recipientEmail) {
      return NextResponse.json({ error: "Recipient email missing; invoice created as draft", invoice }, { status: 400 });
    }
    const resend = new Resend(resendKey);
    const from = brandEmailFrom(brand, process.env.RESEND_FROM_EMAIL?.trim() || "Billing <onboarding@resend.dev>");
    const lines = itemRows
      .filter((l) => l.amount > 0)
      .map((l) => `<li>${l.description}: ${l.quantity} x €${Number(l.unit_price).toFixed(2)} = €${Number(l.amount).toFixed(2)}</li>`)
      .join("");
    const html = `
      <p>Hello,</p>
      <p>Your manual invoice <strong>${invoiceNumber}</strong> for ${billingMonth.slice(0, 7)} is ready.</p>
      <ul>${lines}</ul>
      <p>Subtotal: €${subtotal.toFixed(2)}<br/>VAT: €${taxAmount.toFixed(2)}<br/><strong>Total: €${totalAmount.toFixed(2)}</strong></p>
      <p>Due date: ${dueDate}</p>
      <p>${brand.email_footer_text ?? brand.brand_name}</p>
    `;
    const { error: sErr } = await resend.emails.send({
      from,
      to: recipientEmail,
      subject: `Invoice ${invoiceNumber} - ${(tenant as { name?: string | null }).name ?? "Organization"}`,
      html,
    });
    if (sErr) return NextResponse.json({ error: sErr.message, invoice }, { status: 500 });
    await supabase
      .from("manual_billing_invoices")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", (invoice as { id: string }).id);
  }

  return NextResponse.json({ ok: true, invoice });
}

