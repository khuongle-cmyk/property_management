import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const { contractId } = await req.json();
    if (!contractId) return NextResponse.json({ error: "Missing contractId" }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const { data: contract, error } = await admin
      .from("contracts")
      .select("*")
      .eq("id", contractId)
      .single();

    if (error || !contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    const email = contract.customer_email;
    if (!email) {
      return NextResponse.json({ error: "No customer email on file" }, { status: 400 });
    }

    const token = contract.public_token;
    if (!token) {
      return NextResponse.json({ error: "Contract has no public token" }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
    const signingUrl = `${baseUrl}/contracts/${token}`;

    // Send email via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return NextResponse.json({ error: "Email service not configured" }, { status: 500 });
    }

    const customerName = contract.customer_name || "Customer";
    const contractTitle = contract.title || "Contract";

    const htmlBody = `
      <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
        <div style="background: #21524F; padding: 24px 32px; border-radius: 12px 12px 0 0;">
          <h1 style="color: #ffffff; margin: 0; font-size: 20px;">VillageWorks</h1>
        </div>
        <div style="background: #ffffff; padding: 32px; border: 1px solid #e5e0da; border-top: none; border-radius: 0 0 12px 12px;">
          <h2 style="color: #21524F; margin: 0 0 16px;">Contract Ready for Signing</h2>
          <p style="color: #2c2825; font-size: 15px; line-height: 1.6;">
            Dear ${customerName},
          </p>
          <p style="color: #2c2825; font-size: 15px; line-height: 1.6;">
            Your contract <strong>"${contractTitle}"</strong> is ready for review and signing.
          </p>
          <p style="color: #2c2825; font-size: 15px; line-height: 1.6;">
            Please click the button below to review the contract details and sign electronically.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${signingUrl}" style="display: inline-block; background: #21524F; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
              Review & Sign Contract
            </a>
          </div>
          <p style="color: #8a8580; font-size: 13px; line-height: 1.5;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${signingUrl}" style="color: #21524F;">${signingUrl}</a>
          </p>
          <hr style="border: none; border-top: 1px solid #e5e0da; margin: 24px 0;">
          <p style="color: #8a8580; font-size: 12px;">
            This email was sent by VillageWorks. If you did not expect this contract, please contact us.
          </p>
        </div>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: "VillageWorks <contracts@villageworks.com>",
        to: email,
        subject: `Contract for signing: ${contractTitle}`,
        html: htmlBody,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Failed to send email");
    }

    // Send to counter-signer if dual signing is required
    const { data: contractFull } = await admin
      .from("contracts")
      .select("requires_counter_sign, counter_signer_user_id")
      .eq("id", contractId)
      .single();

    if (contractFull?.requires_counter_sign && contractFull?.counter_signer_user_id) {
      const { data: signerProfile } = await admin
        .from("user_profiles")
        .select("email, first_name, last_name")
        .eq("user_id", contractFull.counter_signer_user_id)
        .single();

      if (signerProfile?.email) {
        const signerName = [signerProfile.first_name, signerProfile.last_name].filter(Boolean).join(" ") || "Team member";
        const counterSignUrl = `${baseUrl}/contracts/${token}?role=counter`;

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: "VillageWorks <contracts@villageworks.com>",
            to: signerProfile.email,
            subject: `Counter-sign required: ${contractTitle}`,
            html: `
          <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
            <div style="background: #21524F; padding: 24px 32px; border-radius: 12px 12px 0 0;">
              <h1 style="color: #ffffff; margin: 0; font-size: 20px;">VillageWorks</h1>
            </div>
            <div style="background: #ffffff; padding: 32px; border: 1px solid #e5e0da; border-top: none; border-radius: 0 0 12px 12px;">
              <h2 style="color: #21524F; margin: 0 0 16px;">Counter-Signature Required</h2>
              <p style="color: #2c2825; font-size: 15px; line-height: 1.6;">Dear ${signerName},</p>
              <p style="color: #2c2825; font-size: 15px; line-height: 1.6;">
                The contract <strong>"${contractTitle}"</strong> has been sent to the client for signing and requires your counter-signature as the VillageWorks representative.
              </p>
              <p style="color: #2c2825; font-size: 15px; line-height: 1.6;">
                You can counter-sign directly from the Contract Editor in the CRM pipeline, or use the link below.
              </p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${counterSignUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
                  Review & Counter-Sign
                </a>
              </div>
              <hr style="border: none; border-top: 1px solid #e5e0da; margin: 24px 0;">
              <p style="color: #8a8580; font-size: 12px;">This is an internal VillageWorks notification.</p>
            </div>
          </div>
        `,
          }),
        });
      }
    }

    // Update contract status to "sent"
    await admin
      .from("contracts")
      .update({ status: "sent", updated_at: new Date().toISOString() })
      .eq("id", contractId);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}