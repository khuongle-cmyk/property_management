import { NextResponse } from "next/server";
import { bookingIsStaffOnBehalf, sendBookingEmailNotification } from "@/lib/booking-email";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type Body = {
  bookingId?: string;
  kind?: "created" | "approved" | "rejected";
  rejectionReason?: string | null;
  onBehalfTenantEmail?: string | null;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bookingId = body.bookingId?.trim();
  if (!bookingId) {
    return NextResponse.json({ error: "bookingId is required" }, { status: 400 });
  }
  const kind = body.kind ?? "created";

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: booking, error: readErr } = await supabase
    .from("bookings")
    .select("id")
    .eq("id", bookingId)
    .maybeSingle();

  if (readErr || !booking) {
    return NextResponse.json({ error: "Forbidden or not found" }, { status: 403 });
  }

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Missing service role configuration";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const extraRaw = body.onBehalfTenantEmail?.trim() ?? "";
  if (extraRaw && kind === "created") {
    const { data: meta, error: metaErr } = await admin
      .from("bookings")
      .select("created_by_user_id, booker_type, booker_user_id")
      .eq("id", bookingId)
      .maybeSingle();

    if (metaErr || !meta) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const row = meta as {
      created_by_user_id: string | null;
      booker_type: string;
      booker_user_id: string | null;
    };

    if (!bookingIsStaffOnBehalf(row.created_by_user_id, row.booker_type, row.booker_user_id)) {
      return NextResponse.json(
        { error: "Tenant notify email is only allowed for owner/manager bookings on behalf of someone else" },
        { status: 400 }
      );
    }
    if (row.created_by_user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const result = await sendBookingEmailNotification({
    client: admin,
    bookingId,
    kind,
    rejectionReason: body.rejectionReason,
    onBehalfTenantEmail: extraRaw || null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Email failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, skipped: result.skipped });
}
