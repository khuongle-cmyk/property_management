/** VillageWorks transactional offer emails (Resend HTML + plain text). */

const petrol = "#0d3d3a";
const gold = "#c8a96e";
const white = "#ffffff";
const beige = "#f5f0e8";
const detailsBg = "#f0f0f0";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function vwHeader(): string {
  return `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${petrol};border-collapse:collapse">
    <tr>
      <td style="padding:20px 24px;text-align:center">
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.14em;color:${white};text-transform:uppercase">VILLAGEWORKS</span>
      </td>
    </tr>
  </table>`;
}

function vwFooterSales(params: { salesName: string; salesEmail: string; salesPhone: string }): string {
  const { salesName, salesEmail, salesPhone } = params;
  const phoneLine = salesPhone.trim()
    ? `<p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333">${esc(salesPhone)}</p>`
    : "";
  return `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${beige};border-collapse:collapse">
    <tr>
      <td style="padding:24px 24px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;line-height:1.6">
        <p style="margin:0"><strong>${esc(salesName)}</strong></p>
        <p style="margin:8px 0 0"><a href="mailto:${esc(salesEmail)}" style="color:${petrol}">${esc(salesEmail)}</a></p>
        ${phoneLine}
      </td>
    </tr>
  </table>`;
}

function vwBottomBar(): string {
  return `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${petrol};border-collapse:collapse">
    <tr>
      <td style="padding:14px 24px;text-align:center">
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${white}">VillageWorks · villageworks.com</span>
      </td>
    </tr>
  </table>`;
}

export type OfferSentEmailParams = {
  customerName: string;
  companyName: string;
  offerTitle: string;
  spaceDetails: string;
  monthlyPrice: string;
  contractLengthMonths: string;
  startDate: string;
  offerLink: string;
  salesName: string;
  salesEmail: string;
  salesPhone: string;
};

export function offerSentEmail(params: OfferSentEmailParams): { subject: string; html: string; text: string } {
  const {
    customerName,
    companyName,
    offerTitle,
    spaceDetails,
    monthlyPrice,
    contractLengthMonths,
    startDate,
    offerLink,
    salesName,
    salesEmail,
    salesPhone,
  } = params;

  const subject = `Your VillageWorks offer — ${offerTitle || "workspace offer"}`;

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#faf9f6">
  ${vwHeader()}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;border-collapse:collapse">
    <tr>
      <td style="padding:28px 24px 8px;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;color:${gold};line-height:1.25">
        Your VillageWorks Offer is Ready
      </td>
    </tr>
    <tr>
      <td style="padding:8px 24px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a2e2e;line-height:1.65">
        Dear ${esc(customerName || "there")}, please find your personalised workspace offer below.
        ${companyName.trim() ? `<br/><br/><span style="opacity:0.85">${esc(companyName)}</span>` : ""}
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 24px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${detailsBg};border-radius:8px;border-collapse:collapse">
          <tr><td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#555;text-transform:uppercase;letter-spacing:0.06em;font-weight:700">Details</td></tr>
          <tr><td style="padding:4px 18px 10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a2e2e"><strong>Space</strong><br/>${esc(spaceDetails || "—")}</td></tr>
          <tr><td style="padding:10px 18px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:${petrol}"><strong>Monthly rent</strong><br/>${esc(monthlyPrice || "—")}</td></tr>
          <tr><td style="padding:10px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a2e2e"><strong>Contract length</strong><br/>${esc(contractLengthMonths || "—")}</td></tr>
          <tr><td style="padding:10px 18px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a2e2e"><strong>Start date</strong><br/>${esc(startDate || "—")}</td></tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 24px 32px;text-align:center">
        <a href="${esc(offerLink)}" style="display:inline-block;padding:16px 32px;background:${petrol};color:${white};font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;text-decoration:none;border-radius:10px">View &amp; Accept Offer</a>
      </td>
    </tr>
  </table>
  ${vwFooterSales({ salesName, salesEmail, salesPhone })}
  ${vwBottomBar()}
</body></html>`;

  const text = [
    "VILLAGEWORKS",
    "",
    "Your VillageWorks Offer is Ready",
    "",
    `Dear ${customerName || "there"}, please find your personalised workspace offer below.`,
    companyName.trim() ? `Company: ${companyName}` : "",
    "",
    `Offer: ${offerTitle}`,
    `Space: ${spaceDetails || "—"}`,
    `Monthly rent: ${monthlyPrice || "—"}`,
    `Contract length: ${contractLengthMonths || "—"}`,
    `Start date: ${startDate || "—"}`,
    "",
    `View & accept: ${offerLink}`,
    "",
    `${salesName}`,
    salesEmail,
    salesPhone.trim() || "",
    "",
    "VillageWorks · villageworks.com",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { subject, html, text };
}

export type OfferAcceptedCustomerEmailParams = {
  customerName: string;
  companyName: string;
  salesName: string;
  salesEmail: string;
  salesPhone: string;
};

export function offerAcceptedCustomerEmail(
  params: OfferAcceptedCustomerEmailParams,
): { subject: string; html: string; text: string } {
  const { customerName, companyName, salesName, salesEmail, salesPhone } = params;
  const subject = "Offer accepted — thank you";

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#faf9f6">
  ${vwHeader()}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;border-collapse:collapse">
    <tr>
      <td style="padding:28px 24px 8px;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;color:${gold};line-height:1.25">
        Offer Accepted — Thank You!
      </td>
    </tr>
    <tr>
      <td style="padding:8px 24px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a2e2e;line-height:1.65">
        Thank you for accepting our offer, ${esc(customerName || "there")}. We are now preparing your contract and will be in touch shortly.
        ${companyName.trim() ? `<br/><br/><span style="opacity:0.85">${esc(companyName)}</span>` : ""}
      </td>
    </tr>
  </table>
  ${vwFooterSales({ salesName, salesEmail, salesPhone })}
  ${vwBottomBar()}
</body></html>`;

  const text = [
    "VILLAGEWORKS",
    "",
    "Offer Accepted — Thank You!",
    "",
    `Thank you for accepting our offer, ${customerName || "there"}. We are now preparing your contract and will be in touch shortly.`,
    "",
    `${salesName}`,
    salesEmail,
    salesPhone.trim() || "",
    "",
    "VillageWorks · villageworks.com",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { subject, html, text };
}

export type OfferAcceptedInternalEmailParams = {
  companyName: string;
  offerTitle: string;
  acceptedAt: string;
  salesName: string;
};

export function offerAcceptedInternalEmail(params: OfferAcceptedInternalEmailParams): {
  subject: string;
  html: string;
  text: string;
} {
  const { companyName, offerTitle, acceptedAt, salesName } = params;
  const subject = `Offer accepted — ${companyName || "Customer"}`;

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.6">
  <p style="margin:0 0 12px"><strong>Offer accepted (internal)</strong></p>
  <p style="margin:0 0 6px"><strong>Company:</strong> ${esc(companyName || "—")}</p>
  <p style="margin:0 0 6px"><strong>Offer title:</strong> ${esc(offerTitle || "—")}</p>
  <p style="margin:0 0 6px"><strong>Accepted at:</strong> ${esc(acceptedAt)}</p>
  <p style="margin:0"><strong>Sales owner:</strong> ${esc(salesName)}</p>
</body></html>`;

  const text = [
    "Offer accepted (internal)",
    "",
    `Company: ${companyName || "—"}`,
    `Offer title: ${offerTitle || "—"}`,
    `Accepted at: ${acceptedAt}`,
    `Sales owner: ${salesName}`,
  ].join("\n");

  return { subject, html, text };
}
