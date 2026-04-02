import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessMarketingRowByTenantId, getMarketingAccess } from "@/lib/marketing/access";

type EmailJoin = {
  id: string;
  subject: string | null;
  source: string | null;
  related_type: string | null;
  related_id: string | null;
  tenant_id: string | null;
  created_at: string | null;
  sent_at: string | null;
  status: string | null;
  from_name: string | null;
  from_email: string | null;
};

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tenantIds, isSuperAdmin, error: aErr } = await getMarketingAccess(supabase, user.id);
  if (aErr) return NextResponse.json({ error: aErr }, { status: 500 });
  if (!isSuperAdmin && tenantIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const rawEmail = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!rawEmail) return NextResponse.json({ error: "email query parameter is required" }, { status: 400 });

  const { data: recs, error } = await supabase
    .from("marketing_email_recipients")
    .select(
      `
      id,
      email_address,
      status,
      sent_at,
      marketing_emails (
        id,
        subject,
        source,
        related_type,
        related_id,
        tenant_id,
        created_at,
        sent_at,
        status,
        from_name,
        from_email
      )
    `,
    )
    .eq("email_address", rawEmail);

  if (error) {
    if (error.code === "42P01") return NextResponse.json({ items: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const access = { tenantIds, isSuperAdmin };
  const items: Array<{
    recipientId: string;
    emailAddress: string;
    recipientStatus: string | null;
    recipientSentAt: string | null;
    email: EmailJoin | null;
  }> = [];

  for (const r of recs ?? []) {
    const row = r as {
      id: string;
      email_address: string;
      status: string | null;
      sent_at: string | null;
      marketing_emails: EmailJoin | EmailJoin[] | null;
    };
    const me = row.marketing_emails;
    const em = Array.isArray(me) ? me[0] : me;
    if (!em) continue;
    if (!canAccessMarketingRowByTenantId(em.tenant_id, access)) continue;
    items.push({
      recipientId: row.id,
      emailAddress: row.email_address,
      recipientStatus: row.status,
      recipientSentAt: row.sent_at,
      email: em,
    });
  }

  items.sort((a, b) => {
    const ta = new Date(a.email?.sent_at ?? a.email?.created_at ?? 0).getTime();
    const tb = new Date(b.email?.sent_at ?? b.email?.created_at ?? 0).getTime();
    return tb - ta;
  });

  return NextResponse.json({ items });
}
