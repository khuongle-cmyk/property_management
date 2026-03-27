import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { rentRollReportToEmailHtml } from "@/lib/reports/report-email-html";
import { normalizeMemberships } from "@/lib/reports/report-access";
import type { RentRollReportModel } from "@/lib/reports/rent-roll-types";

type Body = {
  toEmail?: string;
  report?: RentRollReportModel;
};

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const toEmail = body.toEmail?.trim().toLowerCase();
  const report = body.report;
  if (!toEmail || !report) {
    return NextResponse.json({ error: "toEmail and report are required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membershipRows, error: mErr } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id);

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const { canRunReports } = normalizeMemberships(
    (membershipRows ?? []) as { tenant_id: string | null; role: string | null }[],
  );
  if (!canRunReports) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const resend = getResend();
  if (!resend) {
    return NextResponse.json(
      { error: "Email is not configured (RESEND_API_KEY missing)" },
      { status: 503 },
    );
  }

  const from =
    process.env.RESEND_FROM_EMAIL?.trim() || "Reports <onboarding@resend.dev>";
  const subject = `Rent roll & revenue report (${report.monthKeys[0] ?? ""}–${report.monthKeys[report.monthKeys.length - 1] ?? ""})`;
  const html = rentRollReportToEmailHtml(report);

  const { error } = await resend.emails.send({ from, to: toEmail, subject, html });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
