import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildBookingIcs } from "@/lib/calendar-ics";

export type BookingEmailKind = "created" | "approved" | "rejected";

/** Logged-in owner/manager booking for someone else (not self as registered booker). */
export function bookingIsStaffOnBehalf(
  createdByUserId: string | null,
  bookerType: string,
  bookerUserId: string | null
): boolean {
  if (!createdByUserId) return false;
  if (bookerType === "registered_user" && bookerUserId === createdByUserId) return false;
  return true;
}

type PropertyRel = {
  name?: string;
  address?: string;
  postal_code?: string | null;
  city?: string;
} | null;

type BookingRowDb = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  purpose: string | null;
  total_price: number | string | null;
  visitor_email: string | null;
  visitor_name: string | null;
  booker_type: string;
  booker_user_id: string | null;
  rejection_reason: string | null;
  created_by_user_id: string | null;
  tenant_id: string;
  bookable_spaces: { name: string } | { name: string }[] | null;
  properties: PropertyRel | PropertyRel[] | null;
};

function relOne<T extends { name?: string }>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel;
}

function relName(rel: BookingRowDb["bookable_spaces"]): string | undefined {
  const o = relOne(rel as { name: string } | { name: string }[] | null);
  return o?.name;
}

function relProperty(rel: BookingRowDb["properties"]): PropertyRel {
  if (!rel) return null;
  const row = Array.isArray(rel) ? rel[0] : rel;
  return (row ?? null) as PropertyRel;
}

function formatPropertyAddress(p: PropertyRel): string {
  if (!p) return "";
  const line1 = [p.address ?? "", p.city ?? ""].filter(Boolean).join(", ");
  const line2 = p.postal_code ? ` ${p.postal_code}` : "";
  return (line1 + line2).trim();
}

function formatWhen(start: string, end: string): string {
  try {
    const s = new Date(start);
    const e = new Date(end);
    return `${s.toLocaleString()} – ${e.toLocaleString()}`;
  } catch {
    return `${start} – ${end}`;
  }
}

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

async function resolveUserEmailAndName(
  client: SupabaseClient,
  userId: string
): Promise<{ email: string; name: string } | null> {
  const { data: row } = await client
    .from("users")
    .select("email, display_name")
    .eq("id", userId)
    .maybeSingle();

  if (row?.email) {
    return { email: row.email, name: row.display_name?.trim() || row.email };
  }

  const { data: authData, error } = await client.auth.admin.getUserById(userId);
  const authUser = authData?.user;
  const email = authUser?.email;
  if (error || !authUser || !email) return null;
  const meta = authUser.user_metadata as { full_name?: string } | undefined;
  return {
    email,
    name: meta?.full_name?.trim() || email || "User",
  };
}

function emailFromUsersJoin(users: { email: string } | { email: string }[] | null | undefined): string | null {
  if (!users) return null;
  const row = Array.isArray(users) ? users[0] : users;
  const em = row?.email?.trim();
  return em || null;
}

async function getOwnerManagerEmails(client: SupabaseClient, tenantId: string): Promise<string[]> {
  const { data: rows, error } = await client
    .from("memberships")
    .select("role, users ( email )")
    .eq("tenant_id", tenantId);

  if (error || !rows?.length) return [];

  const emails = new Set<string>();
  for (const row of rows as unknown as { role: string | null; users: { email: string } | { email: string }[] | null }[]) {
    const role = (row.role ?? "").toLowerCase();
    if (role !== "owner" && role !== "manager") continue;
    const em = emailFromUsersJoin(row.users);
    if (em) emails.add(em);
  }
  return [...emails];
}

type Loaded = {
  booking: BookingRowDb;
  spaceName: string;
  propertyName: string;
  addressLine: string;
  when: string;
  price: string;
  bookerEmail: string;
  bookerName: string;
  creatorEmail: string | null;
  creatorName: string | null;
};

async function loadBookingContext(client: SupabaseClient, bookingId: string): Promise<Loaded | null> {
  const { data: booking, error } = await client
    .from("bookings")
    .select(
      `
      id,
      start_at,
      end_at,
      status,
      purpose,
      total_price,
      visitor_email,
      visitor_name,
      booker_type,
      booker_user_id,
      rejection_reason,
      created_by_user_id,
      tenant_id,
      bookable_spaces ( name ),
      properties ( name, address, postal_code, city )
    `
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !booking) return null;

  const b = booking as unknown as BookingRowDb;
  const spaceName = relName(b.bookable_spaces) ?? "Space";
  const prop = relProperty(b.properties);
  const propertyName = prop?.name ?? "Property";
  const addressLine = formatPropertyAddress(prop);
  const when = formatWhen(b.start_at, b.end_at);
  const price =
    b.total_price === null || b.total_price === undefined ? "—" : String(b.total_price);

  let bookerEmail: string | null = null;
  let bookerName = "Guest";

  if (b.booker_type === "visitor") {
    bookerEmail = b.visitor_email?.trim().toLowerCase() ?? null;
    bookerName = b.visitor_name?.trim() ?? "Guest";
  } else if (b.booker_user_id) {
    const u = await resolveUserEmailAndName(client, b.booker_user_id);
    if (u) {
      bookerEmail = u.email.toLowerCase();
      bookerName = u.name;
    }
  }

  if (!bookerEmail) return null;

  let creatorEmail: string | null = null;
  let creatorName: string | null = null;
  if (b.created_by_user_id) {
    const c = await resolveUserEmailAndName(client, b.created_by_user_id);
    if (c) {
      creatorEmail = c.email.toLowerCase();
      creatorName = c.name;
    }
  }

  return {
    booking: b,
    spaceName,
    propertyName,
    addressLine,
    when,
    price,
    bookerEmail,
    bookerName,
    creatorEmail,
    creatorName,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bookingDetailBodyLines(ctx: Loaded): string[] {
  return [
    `<p><strong>${escapeHtml(ctx.spaceName)}</strong> at ${escapeHtml(ctx.propertyName)}</p>`,
    ctx.addressLine
      ? `<p><strong>Address:</strong> ${escapeHtml(ctx.addressLine)}</p>`
      : `<p><strong>Property:</strong> ${escapeHtml(ctx.propertyName)}</p>`,
    `<p><strong>When:</strong> ${escapeHtml(ctx.when)}</p>`,
    `<p><strong>Status:</strong> ${escapeHtml(ctx.booking.status)}</p>`,
    `<p><strong>Total:</strong> ${escapeHtml(ctx.price)}</p>`,
  ];
}

function bookerDetailLines(ctx: Loaded): string[] {
  return [`<p>Hi ${escapeHtml(ctx.bookerName)},</p>`, ...bookingDetailBodyLines(ctx)];
}

function buildIcsFor(ctx: Loaded): string {
  const loc = [ctx.addressLine || ctx.propertyName].filter(Boolean).join(" — ") || ctx.propertyName;
  return buildBookingIcs({
    uid: `${ctx.booking.id}@property-pms.booking`,
    startAt: ctx.booking.start_at,
    endAt: ctx.booking.end_at,
    summary: `${ctx.spaceName} — ${ctx.propertyName}`,
    description: [
      ctx.addressLine ? `Address: ${ctx.addressLine}` : "",
      ctx.booking.purpose ? `Purpose: ${ctx.booking.purpose}` : "",
      `Status: ${ctx.booking.status}`,
      `Total: ${ctx.price}`,
    ]
      .filter(Boolean)
      .join("\\n"),
    location: loc,
  });
}

function bookerPartySummary(ctx: Loaded): string {
  return ctx.booking.booker_type === "visitor"
    ? `${ctx.booking.visitor_name ?? "Visitor"} (${ctx.bookerEmail})`
    : `${ctx.bookerName} (${ctx.bookerEmail})`;
}

function normalizeExtraTenantEmail(raw: string | null | undefined): string | null {
  const s = raw?.trim().toLowerCase() ?? "";
  if (!s || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

async function sendStaffNotifications(
  client: SupabaseClient,
  resend: Resend,
  from: string,
  ctx: Loaded,
  icsAttachment: { filename: string; content: Buffer },
  excludeCreatorEmail: string | null
): Promise<{ ok: boolean; error?: string }> {
  const managerEmails = await getOwnerManagerEmails(client, ctx.booking.tenant_id);
  const creatorNorm = excludeCreatorEmail?.toLowerCase() ?? null;
  const staffTargets = managerEmails.filter((e) => !creatorNorm || e.toLowerCase() !== creatorNorm);

  const bookerSummary = bookerPartySummary(ctx);
  for (const to of staffTargets) {
    const subj = `New booking — ${ctx.propertyName} — ${ctx.spaceName}`;
    const html = [
      `<p>A new booking was created.</p>`,
      `<p><strong>Booked by:</strong> ${escapeHtml(bookerSummary)}</p>`,
      `<p><strong>Space:</strong> ${escapeHtml(ctx.spaceName)}</p>`,
      `<p><strong>Property:</strong> ${escapeHtml(ctx.propertyName)}</p>`,
      ctx.addressLine ? `<p><strong>Address:</strong> ${escapeHtml(ctx.addressLine)}</p>` : "",
      `<p><strong>When:</strong> ${escapeHtml(ctx.when)}</p>`,
      `<p><strong>Status:</strong> ${escapeHtml(ctx.booking.status)}</p>`,
      `<p><strong>Total:</strong> ${escapeHtml(ctx.price)}</p>`,
      ctx.booking.purpose ? `<p><strong>Purpose:</strong> ${escapeHtml(ctx.booking.purpose)}</p>` : "",
      `<p>A calendar invite is attached.</p>`,
    ]
      .filter(Boolean)
      .join("");

    const { error } = await resend.emails.send({
      from,
      to,
      subject: subj,
      html,
      attachments: [icsAttachment],
    });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function sendBookingEmailNotification(params: {
  client: SupabaseClient;
  bookingId: string;
  kind: BookingEmailKind;
  rejectionReason?: string | null;
  /** Optional tenant/guest email when an owner/manager books on behalf (validated by API). */
  onBehalfTenantEmail?: string | null;
}): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const resend = getResend();
  if (!resend) {
    return { ok: true, skipped: "RESEND_API_KEY not set" };
  }

  const from =
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "Property bookings <onboarding@resend.dev>";

  const ctxLoaded = await loadBookingContext(params.client, params.bookingId);
  if (!ctxLoaded) {
    return { ok: false, error: "Booking not found or could not resolve booker email" };
  }

  const ics = buildIcsFor(ctxLoaded);
  const icsAttachment = { filename: "booking.ics", content: Buffer.from(ics, "utf8") };

  if (params.kind === "rejected") {
    const reason = params.rejectionReason ?? ctxLoaded.booking.rejection_reason ?? "";
    const subject = `Booking update: not approved — ${ctxLoaded.spaceName}`;
    const html = [
      ...bookerDetailLines(ctxLoaded),
      `<p>Your booking request could not be approved.</p>`,
      reason ? `<p><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : "",
      `<p>If you have questions, please reply to this email.</p>`,
    ].join("");
    const { error } = await resend.emails.send({ from, to: ctxLoaded.bookerEmail, subject, html });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  if (params.kind === "approved") {
    const subject = `Booking confirmed — ${ctxLoaded.spaceName}`;
    const html = [
      ...bookerDetailLines(ctxLoaded),
      `<p>Your booking has been <strong>confirmed</strong>.</p>`,
      `<p>A calendar invite is attached.</p>`,
    ].join("");
    const { error } = await resend.emails.send({
      from,
      to: ctxLoaded.bookerEmail,
      subject,
      html,
      attachments: [icsAttachment],
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const pendingNote =
    ctxLoaded.booking.status === "pending"
      ? "<p>Your request is <strong>pending approval</strong>. We will email you when it is confirmed.</p>"
      : "<p>Your booking is <strong>confirmed</strong>.</p>";

  const bookerSubject =
    ctxLoaded.booking.status === "pending"
      ? `Booking received (pending) — ${ctxLoaded.spaceName}`
      : `Booking confirmed — ${ctxLoaded.spaceName}`;
  const bookerHtml = [
    ...bookerDetailLines(ctxLoaded),
    pendingNote,
    `<p>A calendar invite is attached.</p>`,
  ].join("");

  const onBehalf = bookingIsStaffOnBehalf(
    ctxLoaded.booking.created_by_user_id,
    ctxLoaded.booking.booker_type,
    ctxLoaded.booking.booker_user_id
  );

  if (onBehalf) {
    if (!ctxLoaded.creatorEmail) {
      return { ok: false, error: "Could not resolve submitting user email" };
    }

    const emailed = new Set<string>([ctxLoaded.creatorEmail.toLowerCase()]);

    const whoEscaped = escapeHtml(bookerPartySummary(ctxLoaded));
    const mgrName = escapeHtml(ctxLoaded.creatorName ?? "there");
    const detailLines = bookingDetailBodyLines(ctxLoaded);

    const mgrHtml = [
      `<p>Hi ${mgrName},</p>`,
      `<p>You made a booking on behalf of <strong>${whoEscaped}</strong>.</p>`,
      ...detailLines,
      pendingNote,
      `<p>A calendar invite is attached.</p>`,
    ].join("");

    const mgrSend = await resend.emails.send({
      from,
      to: ctxLoaded.creatorEmail,
      subject: bookerSubject,
      html: mgrHtml,
      attachments: [icsAttachment],
    });
    if (mgrSend.error) return { ok: false, error: mgrSend.error.message };

    const extra = normalizeExtraTenantEmail(params.onBehalfTenantEmail);
    if (extra && !emailed.has(extra)) {
      const tenHtml = [
        `<p>Hi,</p>`,
        `<p>A booking was arranged for you at <strong>${escapeHtml(ctxLoaded.propertyName)}</strong>.</p>`,
        pendingNote,
        `<p><strong>Arranged by:</strong> ${mgrName}</p>`,
        `<p><strong>For:</strong> ${whoEscaped}</p>`,
        ...detailLines,
        `<p>A calendar invite is attached.</p>`,
      ].join("");
      const tenantSend = await resend.emails.send({
        from,
        to: extra,
        subject: bookerSubject,
        html: tenHtml,
        attachments: [icsAttachment],
      });
      if (tenantSend.error) return { ok: false, error: tenantSend.error.message };
      emailed.add(extra);
    }

    // Guest / member on the booking always gets the same confirmation as self-service
    // (visitors: email from the form; members: resolved profile email).
    const bookerNorm = ctxLoaded.bookerEmail?.toLowerCase() ?? "";
    if (bookerNorm && !emailed.has(bookerNorm)) {
      const bookerSend = await resend.emails.send({
        from,
        to: ctxLoaded.bookerEmail,
        subject: bookerSubject,
        html: bookerHtml,
        attachments: [icsAttachment],
      });
      if (bookerSend.error) return { ok: false, error: bookerSend.error.message };
      emailed.add(bookerNorm);
    }

    const staffOnBehalf = await sendStaffNotifications(
      params.client,
      resend,
      from,
      ctxLoaded,
      icsAttachment,
      ctxLoaded.creatorEmail
    );
    if (!staffOnBehalf.ok) return { ok: false, error: staffOnBehalf.error };
    return { ok: true };
  }

  const sendBooker = await resend.emails.send({
    from,
    to: ctxLoaded.bookerEmail,
    subject: bookerSubject,
    html: bookerHtml,
    attachments: [icsAttachment],
  });
  if (sendBooker.error) return { ok: false, error: sendBooker.error.message };

  const staffResult = await sendStaffNotifications(
    params.client,
    resend,
    from,
    ctxLoaded,
    icsAttachment,
    ctxLoaded.creatorEmail
  );
  if (!staffResult.ok) return { ok: false, error: staffResult.error };
  return { ok: true };
}
