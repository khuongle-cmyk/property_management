"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useCustomerPortal } from "@/context/CustomerPortalContext";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { formatDate } from "@/lib/date/format";

const PETROL = "#0D4F4F";

type BookingRow = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  total_price: number | string | null;
  bookable_spaces: { name: string } | { name: string }[] | null;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  status: string;
  amount: number | string;
  currency: string;
  due_date: string;
  created_at: string;
};

function spaceName(b: BookingRow): string {
  const s = b.bookable_spaces;
  if (!s) return "Space";
  if (Array.isArray(s)) return s[0]?.name ?? "Space";
  return s.name ?? "Space";
}

export default function CustomerPortalDashboardPage() {
  const { customerUser, company } = useCustomerPortal();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [upcomingCount, setUpcomingCount] = useState<number | null>(null);
  const [monthCount, setMonthCount] = useState<number | null>(null);
  const [pendingInvoices, setPendingInvoices] = useState<number | null>(null);
  const [outstanding, setOutstanding] = useState<number | null>(null);
  const [nextBooking, setNextBooking] = useState<BookingRow | null>(null);
  const [recentInvoices, setRecentInvoices] = useState<InvoiceRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const firstName = customerUser?.first_name?.trim() || "there";
  const companyName = company?.name ?? "";

  useEffect(() => {
    if (!customerUser?.id || !customerUser.company_id) return;

    let cancelled = false;
    (async () => {
      setLoadErr(null);
      const now = new Date();
      const nowIso = now.toISOString();

      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      const { count: upCount, error: uErr } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("customer_user_id", customerUser.id)
        .gte("start_at", nowIso)
        .neq("status", "cancelled");

      const { data: monthRows, error: mErr } = await supabase
        .from("bookings")
        .select("id")
        .eq("customer_user_id", customerUser.id)
        .gte("start_at", startOfMonth.toISOString())
        .lte("start_at", endOfMonth.toISOString());

      const { data: nextRows, error: nErr } = await supabase
        .from("bookings")
        .select("id, start_at, end_at, status, total_price, bookable_spaces(name)")
        .eq("customer_user_id", customerUser.id)
        .gte("start_at", nowIso)
        .neq("status", "cancelled")
        .order("start_at", { ascending: true })
        .limit(1);

      const { count: pendCount, error: pErr } = await supabase
        .from("customer_invoices")
        .select("id", { count: "exact", head: true })
        .eq("customer_company_id", customerUser.company_id)
        .eq("status", "pending");

      const { data: outRows, error: oErr } = await supabase
        .from("customer_invoices")
        .select("amount")
        .eq("customer_company_id", customerUser.company_id)
        .in("status", ["pending", "overdue"]);

      const { data: invRecent, error: rErr } = await supabase
        .from("customer_invoices")
        .select("id, invoice_number, status, amount, currency, due_date, created_at")
        .eq("customer_company_id", customerUser.company_id)
        .order("created_at", { ascending: false })
        .limit(5);

      if (cancelled) return;

      if (uErr) setLoadErr(uErr.message);
      if (mErr && !uErr) setLoadErr(mErr.message);
      if (nErr && !uErr && !mErr) setLoadErr(nErr.message);

      const invErrs = [pErr, oErr, rErr].filter(Boolean);
      for (const e of invErrs) {
        const msg = e?.message ?? "";
        if (msg && !msg.includes("customer_invoices") && !msg.includes("schema cache")) {
          setLoadErr((prev) => prev ?? msg);
        }
      }

      setUpcomingCount(upCount ?? 0);
      setMonthCount(monthRows?.length ?? 0);
      setNextBooking((nextRows?.[0] as BookingRow) ?? null);

      if (!pErr) setPendingInvoices(pendCount ?? 0);
      else setPendingInvoices(0);

      if (!oErr && outRows) {
        setOutstanding((outRows as { amount: string }[]).reduce((a, x) => a + Number(x.amount ?? 0), 0));
      } else setOutstanding(0);

      if (!rErr && invRecent) setRecentInvoices(invRecent as InvoiceRow[]);
      else setRecentInvoices([]);
    })();

    return () => {
      cancelled = true;
    };
  }, [customerUser, supabase]);

  const card: CSSProperties = {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 16,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  };

  const startNext = nextBooking ? new Date(nextBooking.start_at) : null;
  const endNext = nextBooking ? new Date(nextBooking.end_at) : null;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: PETROL }}>
          Welcome, {firstName}!
        </h1>
        {companyName ? (
          <p style={{ margin: "8px 0 0", fontSize: 16, color: "#64748b" }}>{companyName}</p>
        ) : null}
      </div>

      {loadErr ? (
        <p style={{ color: "#b91c1c", fontSize: 14 }} role="alert">
          {loadErr}
        </p>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(min(160px, 100%), 1fr))",
          gap: 12,
        }}
      >
        <div style={card}>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Upcoming bookings</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: PETROL, marginTop: 6 }}>{upcomingCount ?? "—"}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Bookings this month</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: PETROL, marginTop: 6 }}>{monthCount ?? "—"}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Pending invoices</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: PETROL, marginTop: 6 }}>{pendingInvoices ?? "—"}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Outstanding</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: PETROL, marginTop: 6 }}>
            {outstanding != null ? `€${outstanding.toFixed(2)}` : "—"}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))" }}>
        <div style={card}>
          <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Next booking</h2>
          {nextBooking && startNext && endNext ? (
            <>
              <div style={{ fontWeight: 600, color: PETROL }}>{spaceName(nextBooking)}</div>
              <div style={{ fontSize: 14, color: "#475569", marginTop: 6 }}>{formatDate(nextBooking.start_at)}</div>
              <div style={{ fontSize: 14, color: "#475569" }}>
                {startNext.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} –{" "}
                {endNext.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </div>
            </>
          ) : (
            <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>No upcoming bookings.</p>
          )}
          <Link href="/portal/book" style={{ display: "inline-block", marginTop: 12, color: PETROL, fontWeight: 600, fontSize: 14 }}>
            Make a booking →
          </Link>
        </div>

        <div style={card}>
          <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Recent invoices</h2>
          {recentInvoices.length === 0 ? (
            <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>No invoices yet.</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
              {recentInvoices.map((inv) => (
                <li key={inv.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }}>
                  <span style={{ color: "#334155" }}>{inv.invoice_number}</span>
                  <span style={{ fontWeight: 600 }}>
                    {inv.currency} {Number(inv.amount).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/portal/invoices" style={{ display: "inline-block", marginTop: 12, color: PETROL, fontWeight: 600, fontSize: 14 }}>
            View all →
          </Link>
        </div>
      </div>
    </div>
  );
}
