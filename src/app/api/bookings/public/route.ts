import { NextResponse } from "next/server";
import { sendBookingEmailNotification } from "@/lib/booking-email";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type Body = {
  propertyId?: string;
  spaceId?: string;
  startAt?: string;
  endAt?: string;
  visitorName?: string;
  visitorEmail?: string;
  purpose?: string;
  attendeeCount?: number;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const propertyId = body.propertyId?.trim();
  const spaceId = body.spaceId?.trim();
  const startAt = body.startAt?.trim();
  const endAt = body.endAt?.trim();
  const visitorName = body.visitorName?.trim();
  const visitorEmail = body.visitorEmail?.trim()?.toLowerCase();
  const purpose = body.purpose?.trim() ?? null;
  const attendeeCount =
    typeof body.attendeeCount === "number" && body.attendeeCount >= 1
      ? Math.floor(body.attendeeCount)
      : 1;

  if (!propertyId || !spaceId || !startAt || !endAt || !visitorName || !visitorEmail) {
    return NextResponse.json(
      { error: "propertyId, spaceId, startAt, endAt, visitorName, visitorEmail are required" },
      { status: 400 }
    );
  }

  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return NextResponse.json({ error: "Invalid time range" }, { status: 400 });
  }

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server configuration missing";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const { data: space, error: spaceErr } = await admin
    .from("bookable_spaces")
    .select("id, property_id, space_status, space_type, is_published")
    .eq("id", spaceId)
    .maybeSingle();

  if (spaceErr || !space) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (space.property_id !== propertyId) {
    return NextResponse.json({ error: "Space does not belong to this property" }, { status: 400 });
  }
  const row = space as { space_type?: string; space_status?: string; is_published?: boolean | null };
  if (row.space_type === "office") {
    return NextResponse.json({ error: "Offices are not bookable by the hour here" }, { status: 409 });
  }
  const st = (row.space_status ?? "").toLowerCase();
  const allowedStatuses = new Set(["available", "vacant", "active"]);
  if (!allowedStatuses.has(st)) {
    return NextResponse.json({ error: "Space is not available for booking" }, { status: 400 });
  }
  if (row.is_published === false) {
    return NextResponse.json({ error: "Space is not available for public booking" }, { status: 409 });
  }

  const { data: overlapping, error: overlapErr } = await admin
    .from("bookings")
    .select("id")
    .eq("space_id", spaceId)
    .eq("status", "confirmed")
    .lt("start_at", end.toISOString())
    .gt("end_at", start.toISOString());
  if (overlapErr) {
    return NextResponse.json({ error: overlapErr.message }, { status: 500 });
  }
  if (overlapping && overlapping.length > 0) {
    return NextResponse.json({ error: "Space already booked for this time" }, { status: 400 });
  }

  const { data: inserted, error: insErr } = await admin
    .from("bookings")
    .insert({
      space_id: spaceId,
      booker_type: "visitor",
      visitor_name: visitorName,
      visitor_email: visitorEmail,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      purpose,
      attendee_count: attendeeCount,
    })
    .select("id, status, total_price")
    .maybeSingle();

  if (insErr || !inserted) {
    const msg = insErr?.message ?? "Insert failed";
    const code = msg.includes("already booked") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status: code });
  }

  const emailResult = await sendBookingEmailNotification({
    client: admin,
    bookingId: inserted.id,
    kind: "created",
  });

  return NextResponse.json({
    ok: true,
    booking: inserted,
    emailSkipped: emailResult.skipped,
    emailError: emailResult.ok ? null : emailResult.error,
  });
}
