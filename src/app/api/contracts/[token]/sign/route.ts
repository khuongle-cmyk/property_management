import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createOnboardingTasksFromContract } from "@/lib/tasks/automation";

type Ctx = { params: Promise<{ token: string }> };

const CONTRACT_SELECT_PUBLIC =
  "id,title,status,signing_method,is_template,public_token,customer_name,customer_company,company_id,property_id,space_details,monthly_price,contract_length_months,start_date,intro_text,terms_text,contract_body,signed_at,signed_by_name,requires_counter_sign,counter_signed_by_name,counter_signed_at,counter_signer_user_id,pricing_notes,furniture_included,furniture_description,furniture_monthly_price";

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
      .select("id,status,signing_method,is_template,signed_at,counter_signed_at")
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

    const body = ((await _req.json().catch(() => null)) ?? {}) as {
      signedByName?: string;
      signatureData?: unknown;
      isCounterSign?: boolean;
    };
    const { signedByName: rawName, signatureData, isCounterSign } = body;
    const signedByName = typeof rawName === "string" ? rawName : "";
    if (!signedByName.trim() || signedByName.trim().length < 2) {
      return NextResponse.json({ error: "Please provide your full name to sign." }, { status: 400 });
    }

    const ip =
      _req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      _req.headers.get("x-real-ip")?.trim() ||
      null;

    const sendFullySignedConfirmationToAllParties = async () => {
      try {
        const { data: signedContract } = await admin
          .from("contracts")
          .select("customer_email, customer_name, title, counter_signer_user_id, lead_id, company_id")
          .eq("id", row.id)
          .single();

        if (signedContract) {
          const resendKey = process.env.RESEND_API_KEY;
          const contractTitle = signedContract.title || "Contract";
          const customerName = signedContract.customer_name || "Customer";

          if (resendKey) {
            const confirmHtml = (recipientName: string, isInternal: boolean) => `
        <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
          <div style="background: #21524F; padding: 24px 32px; border-radius: 12px 12px 0 0;">
            <h1 style="color: #ffffff; margin: 0; font-size: 20px;">VillageWorks</h1>
          </div>
          <div style="background: #ffffff; padding: 32px; border: 1px solid #e5e0da; border-top: none; border-radius: 0 0 12px 12px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <div style="width: 56px; height: 56px; border-radius: 50%; background: #eafaf1; display: inline-flex; align-items: center; justify-content: center;">
                <span style="font-size: 28px; color: #27ae60;">✓</span>
              </div>
            </div>
            <h2 style="color: #21524F; margin: 0 0 16px; text-align: center;">Contract Fully Signed</h2>
            <p style="color: #2c2825; font-size: 15px; line-height: 1.6;">Dear ${recipientName},</p>
            <p style="color: #2c2825; font-size: 15px; line-height: 1.6;">
              The contract <strong>"${contractTitle}"</strong> has been fully signed by all parties.${isInternal ? "" : " Welcome to VillageWorks!"}
            </p>
            ${
              !isInternal
                ? `
              <div style="background: #f9f1e5; border-radius: 8px; padding: 16px 20px; margin: 24px 0;">
                <p style="margin: 0; font-size: 14px; color: #2c2825;">
                  <strong>What happens next:</strong><br>
                  1. You'll receive your access credentials<br>
                  2. A welcome package with building info<br>
                  3. Your workspace will be ready on the start date
                </p>
              </div>
            `
                : `
              <p style="color: #2c2825; font-size: 15px; line-height: 1.6;">
                Onboarding tasks have been created automatically. Please check the Tasks page for next steps.
              </p>
            `
            }
            <p style="color: #2c2825; font-size: 15px;">Best regards,<br><strong>VillageWorks Team</strong></p>
            <hr style="border: none; border-top: 1px solid #e5e0da; margin: 24px 0;">
            <p style="color: #8a8580; font-size: 12px; text-align: center;">© ${new Date().getFullYear()} VillageWorks Finland Oy</p>
          </div>
        </div>
      `;

            const sendEmail = async (to: string, name: string, isInternalRecipient: boolean) => {
              const res = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
                body: JSON.stringify({
                  from: "VillageWorks <contracts@villageworks.com>",
                  to,
                  subject: `Contract signed: ${contractTitle}`,
                  html: confirmHtml(name, isInternalRecipient),
                }),
              });
              if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                console.error("Resend contract confirmation error:", errJson);
              }
            };

            if (signedContract.customer_email) {
              await sendEmail(signedContract.customer_email, customerName, false);
            }

            const internalEmails = new Set<string>();
            const internalRecipients: { email: string; name: string }[] = [];

            if (signedContract.counter_signer_user_id) {
              const { data: csProfile } = await admin
                .from("user_profiles")
                .select("email, first_name, last_name")
                .eq("user_id", signedContract.counter_signer_user_id)
                .single();
              if (csProfile?.email) {
                internalEmails.add(csProfile.email);
                internalRecipients.push({
                  email: csProfile.email,
                  name: [csProfile.first_name, csProfile.last_name].filter(Boolean).join(" ") || "Team member",
                });
              }
            }

            const leadId = signedContract.lead_id || signedContract.company_id;
            if (leadId) {
              const { data: lead } = await admin.from("leads").select("assigned_agent_user_id").eq("id", leadId).single();
              if (lead?.assigned_agent_user_id) {
                const { data: agentProfile } = await admin
                  .from("user_profiles")
                  .select("email, first_name, last_name")
                  .eq("user_id", lead.assigned_agent_user_id)
                  .single();
                if (agentProfile?.email && !internalEmails.has(agentProfile.email)) {
                  internalRecipients.push({
                    email: agentProfile.email,
                    name: [agentProfile.first_name, agentProfile.last_name].filter(Boolean).join(" ") || "Team member",
                  });
                }
              }
            }

            for (const r of internalRecipients) {
              await sendEmail(r.email, r.name, true);
            }
          }
        }
      } catch (emailErr) {
        console.error("Error sending confirmation emails:", emailErr);
      }
    };

    if (isCounterSign) {
      // Counter-signing
      if (row.counter_signed_at) {
        return NextResponse.json({ ok: true, alreadySigned: true });
      }

      const { error: csErr } = await admin
        .from("contracts")
        .update({
          counter_signed_by_name: signedByName.trim(),
          counter_signed_at: new Date().toISOString(),
          counter_signature_data: signatureData ?? null,
        })
        .eq("id", row.id);

      if (csErr) return NextResponse.json({ error: csErr.message }, { status: 500 });

      // Check if client has also signed — if so, mark as fully signed
      const { data: checkContract } = await admin.from("contracts").select("signed_at").eq("id", row.id).single();

      if (checkContract?.signed_at) {
        await admin.from("contracts").update({ status: "signed_digital" }).eq("id", row.id);

        // Move lead to won
        const { data: contractForLead } = await admin
          .from("contracts")
          .select("lead_id, company_id, tenant_id, property_id, start_date")
          .eq("id", row.id)
          .single();

        const leadIdToWin = contractForLead?.lead_id || contractForLead?.company_id;
        if (leadIdToWin) {
          const now = new Date().toISOString();
          await admin
            .from("leads")
            .update({
              stage: "won",
              stage_changed_at: now,
              won_at: now,
              updated_at: now,
            })
            .eq("id", leadIdToWin);
        }

        // Create onboarding tasks
        if (contractForLead?.tenant_id && contractForLead?.property_id) {
          try {
            await createOnboardingTasksFromContract({
              supabase: admin,
              contractId: row.id,
              tenantId: contractForLead.tenant_id,
              leadId: leadIdToWin || null,
              propertyId: contractForLead.property_id,
              roomId: null,
              contractStartDate: contractForLead.start_date || new Date().toISOString().slice(0, 10),
            });
          } catch (e) {
            console.error("Task creation error:", e);
          }
        }

        await sendFullySignedConfirmationToAllParties();
      }

      return NextResponse.json({ ok: true });
    }

    if (row.status !== "sent" && row.status !== "draft") {
      return NextResponse.json({ error: "This contract is not available for signing yet" }, { status: 400 });
    }

    const { data: fullRow } = await admin
      .from("contracts")
      .select("requires_counter_sign, counter_signed_at")
      .eq("id", row.id)
      .single();

    const needsCounterSign = Boolean(fullRow?.requires_counter_sign && !fullRow?.counter_signed_at);

    const update: Record<string, unknown> = {
      status: needsCounterSign ? "partially_signed" : "signed_digital",
      signed_at: new Date().toISOString(),
      signed_by_name: signedByName.trim(),
      signature_data: signatureData ?? null,
      signed_ip: ip,
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
    // Only move lead to won if fully signed
    if (!needsCounterSign) {
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
    }

    // Create onboarding tasks from the signed contract
    try {
      const { data: fullContract, error: fcErr } = await admin
        .from("contracts")
        .select("id, tenant_id, lead_id, company_id, property_id, start_date")
        .eq("id", contract.id)
        .single();

      console.log("Task creation - fullContract:", JSON.stringify(fullContract));
      console.log("Task creation - fcErr:", fcErr);

      if (fullContract && fullContract.tenant_id && fullContract.property_id) {
        console.log("Task creation - calling createOnboardingTasksFromContract");
        const result = await createOnboardingTasksFromContract({
          supabase: admin,
          contractId: fullContract.id,
          tenantId: fullContract.tenant_id,
          leadId: fullContract.lead_id || fullContract.company_id || null,
          propertyId: fullContract.property_id,
          roomId: null,
          contractStartDate: fullContract.start_date || new Date().toISOString().slice(0, 10),
        });
        console.log("Task creation - result:", JSON.stringify(result));
      } else {
        console.log("Task creation - skipped, missing data");
      }
    } catch (taskErr) {
      console.error("Error creating onboarding tasks:", taskErr);
    }

    if (!needsCounterSign) {
      await sendFullySignedConfirmationToAllParties();
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
