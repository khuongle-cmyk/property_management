"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";

const linkStyle = (active: boolean): CSSProperties => ({
  padding: "8px 12px",
  borderRadius: 10,
  border: `1px solid ${active ? "#111" : "#ddd"}`,
  background: active ? "#111" : "#fff",
  color: active ? "#fff" : "#111",
  textDecoration: "none",
  fontSize: 14,
});

function canSeeManageBookingsNav(role: string): boolean {
  return ["owner", "manager", "customer_service"].includes(role);
}

export default function AppNav() {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [showManageBookings, setShowManageBookings] = useState(false);
  const [showOwnerDashboard, setShowOwnerDashboard] = useState(false);
  const [showRoomsNav, setShowRoomsNav] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;

      if (!user) {
        setLoggedIn(false);
        setShowManageBookings(false);
        setShowOwnerDashboard(false);
        setShowRoomsNav(false);
        setReady(true);
        return;
      }

      setLoggedIn(true);
      const { data: memberships } = await supabase.from("memberships").select("role");
      const roles = (memberships ?? []).map((m) => (m.role ?? "").toLowerCase());
      if (cancelled) return;

      setShowManageBookings(roles.some(canSeeManageBookingsNav));
      setShowOwnerDashboard(roles.some((r) => ["owner", "super_admin"].includes(r)));
      setShowRoomsNav(
        roles.some((r) =>
          [
            "super_admin",
            "owner",
            "manager",
            "viewer",
            "customer_service",
            "accounting",
            "maintenance",
            "tenant",
          ].includes(r)
        )
      );
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <header style={{ marginBottom: 20, minHeight: 40 }}>
        <span style={{ color: "#888", fontSize: 14 }}>Loading…</span>
      </header>
    );
  }

  return (
    <header
      style={{
        marginBottom: 20,
        paddingBottom: 16,
        borderBottom: "1px solid #eee",
      }}
    >
      <nav
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        <Link href="/" style={linkStyle(pathname === "/")}>
          Home
        </Link>

        {loggedIn ? (
          <>
            <Link
              href="/bookings"
              style={linkStyle(pathname === "/bookings" || pathname === "/bookings/calendar")}
            >
              Bookings Calendar
            </Link>
            <Link href="/bookings/new" style={linkStyle(pathname === "/bookings/new")}>
              Make a Booking
            </Link>
            <Link href="/bookings/my" style={linkStyle(pathname === "/bookings/my")}>
              My Bookings
            </Link>
            {showRoomsNav ? (
              <Link href="/rooms" style={linkStyle(pathname === "/rooms" || pathname.startsWith("/rooms/"))}>
                Rooms
              </Link>
            ) : null}
            {showManageBookings ? (
              <Link href="/bookings/manage" style={linkStyle(pathname === "/bookings/manage")}>
                Manage Bookings
              </Link>
            ) : null}
          </>
        ) : null}

        {showOwnerDashboard ? (
          <Link href="/dashboard" style={linkStyle(pathname === "/dashboard")}>
            Owner dashboard
          </Link>
        ) : null}

        <span style={{ flex: 1, minWidth: 8 }} />

        {loggedIn ? (
          <Link href="/book/public" style={linkStyle(pathname === "/book/public")}>
            Visitor booking
          </Link>
        ) : (
          <>
            <Link href="/login" style={linkStyle(pathname === "/login")}>
              Sign in
            </Link>
            <Link href="/book/public" style={linkStyle(pathname === "/book/public")}>
              Visitor booking
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
