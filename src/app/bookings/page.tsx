"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase/browser";

export default function BookingsHomePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      if (!cancelled) {
        setEmail(user.email ?? null);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    return <p>Loading...</p>;
  }

  return (
    <div>
      <h1 className="vw-admin-page-title" style={{ margin: "0 0 8px" }}>Bookings</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Reserve meeting rooms, offices, and desks{email ? ` · ${email}` : ""}.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
          marginTop: 20,
        }}
      >
        <Link
          href="/bookings/calendar"
          style={{
            border: "1px solid #eee",
            borderRadius: 12,
            padding: 16,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Calendar</div>
          <div style={{ color: "#666", fontSize: 14 }}>
            Property-wide schedule with status colors.
          </div>
        </Link>
        <Link
          href="/bookings/new"
          style={{
            border: "1px solid #eee",
            borderRadius: 12,
            padding: 16,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>New booking</div>
          <div style={{ color: "#666", fontSize: 14 }}>Pick a space, time, and details.</div>
        </Link>
        <Link
          href="/bookings/my"
          style={{
            border: "1px solid #eee",
            borderRadius: 12,
            padding: 16,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>My bookings</div>
          <div style={{ color: "#666", fontSize: 14 }}>Track status and cancel if needed.</div>
        </Link>
        <Link
          href="/bookings/manage"
          style={{
            border: "1px solid #eee",
            borderRadius: 12,
            padding: 16,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Manage</div>
          <div style={{ color: "#666", fontSize: 14 }}>
            Approve or reject requests (owners & managers).
          </div>
        </Link>
      </div>

      <p style={{ marginTop: 24, fontSize: 14, color: "#666" }}>
        Outside guests can use the{" "}
        <Link href="/book/public">public booking page</Link> (no account required).
      </p>
    </div>
  );
}
