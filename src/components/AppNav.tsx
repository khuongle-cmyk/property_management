"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { useBrand } from "@/components/BrandProvider";
import { getSupabaseClient } from "@/lib/supabase/browser";

const itemStyle = (active: boolean, b: { white: string; secondary: string }): CSSProperties => ({
  display: "block",
  padding: "10px 12px",
  borderRadius: 8,
  textDecoration: "none",
  fontSize: 14,
  fontWeight: active ? 600 : 500,
  color: b.white,
  background: active ? b.secondary : "transparent",
  transition: "background 120ms ease",
});

function canSeeManageBookingsNav(role: string): boolean {
  return ["owner", "manager", "customer_service"].includes(role);
}

export default function AppNav() {
  const { brand } = useBrand();
  const b = {
    primary: brand.primary_color,
    secondary: brand.secondary_color,
    sidebar: brand.sidebar_color,
    background: brand.background_color,
    text: brand.text_color,
    accent: brand.accent_color,
    white: "#ffffff",
  };
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [displayName, setDisplayName] = useState("User");
  const [email, setEmail] = useState("");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [showManageBookings, setShowManageBookings] = useState(false);
  const [showOwnerDashboard, setShowOwnerDashboard] = useState(false);
  const [showRoomsNav, setShowRoomsNav] = useState(false);
  const [showCrmNav, setShowCrmNav] = useState(false);
  const [showReportsNav, setShowReportsNav] = useState(false);

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
        setIsSuperAdmin(false);
        setShowManageBookings(false);
        setShowOwnerDashboard(false);
        setShowRoomsNav(false);
        setShowCrmNav(false);
        setShowReportsNav(false);
        setReady(true);
        return;
      }

      setLoggedIn(true);
      setDisplayName(
        String(
          user.user_metadata?.full_name ??
            user.user_metadata?.name ??
            user.email?.split("@")[0] ??
            "User",
        ),
      );
      setEmail(user.email ?? "");
      const { data: memberships } = await supabase.from("memberships").select("role");
      const roles = (memberships ?? []).map((m) => (m.role ?? "").toLowerCase());
      if (cancelled) return;
      setIsSuperAdmin(roles.includes("super_admin"));

      setShowReportsNav(
        roles.some((r) =>
          ["super_admin", "owner", "manager", "accounting", "viewer"].includes(r),
        ),
      );
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
      setShowCrmNav(
        roles.some((r) =>
          [
            "super_admin",
            "owner",
            "manager",
            "customer_service",
            "agent",
            "viewer",
          ].includes(r)
        )
      );
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function onLogout() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (!ready) {
    return (
      <aside style={{ width: 260, background: b.sidebar, minHeight: "100vh", display: "none" }} />
    );
  }

  const sections: Array<{ title: string; items: Array<{ href: string; label: string; visible: boolean }> }> = [
    {
      title: "OVERVIEW",
      items: [
        { href: "/dashboard", label: "Dashboard", visible: showOwnerDashboard },
        { href: "/dashboard", label: "Properties", visible: loggedIn },
        { href: "/tasks", label: "Tasks", visible: loggedIn },
        { href: "/offices", label: "Offices", visible: loggedIn && showRoomsNav },
        { href: "/meeting-rooms", label: "Meeting rooms", visible: loggedIn && showRoomsNav },
        { href: "/venues", label: "Venues", visible: loggedIn && showRoomsNav },
        { href: "/coworking", label: "Coworking / Hot desks", visible: loggedIn && showRoomsNav },
        { href: "/virtual-office", label: "Virtual Office", visible: loggedIn && showRoomsNav },
        { href: "/rooms", label: "Rooms (all products)", visible: loggedIn && showRoomsNav },
        { href: "/rooms/furniture", label: "Furniture", visible: loggedIn && showRoomsNav },
      ],
    },
    {
      title: "BOOKINGS",
      items: [
        { href: "/bookings", label: "Calendar", visible: loggedIn },
        { href: "/bookings/new", label: "Make a Booking", visible: loggedIn },
        { href: "/bookings/my", label: "My Bookings", visible: loggedIn },
      ],
    },
    {
      title: "CRM",
      items: [
        { href: "/crm", label: "Pipeline", visible: loggedIn && showCrmNav },
        { href: "/crm/contacts", label: "Contacts", visible: loggedIn && showCrmNav },
      ],
    },
    {
      title: "FINANCE",
      items: [
        { href: "/bookings/manage", label: "Invoices", visible: loggedIn && showManageBookings },
        { href: "/reports", label: "Reports", visible: loggedIn && showReportsNav },
      ],
    },
    {
      title: "ADMIN",
      items: [
        { href: "/super-admin", label: "All organizations", visible: loggedIn && isSuperAdmin },
        { href: "/super-admin", label: "User management", visible: loggedIn && isSuperAdmin },
        { href: "/settings", label: "Settings", visible: loggedIn && isSuperAdmin },
      ],
    },
  ];

  const navBody = (
    <>
      <div style={{ padding: 18, borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
        <img
          src={brand.logo_white_url ?? brand.logo_url ?? ""}
          alt={brand.brand_name}
          style={{ width: "100%", maxWidth: 190, height: "auto", display: "block" }}
        />
      </div>
      <nav style={{ display: "grid", gap: 14, padding: 14 }}>
        {sections.map((group) => {
          const visibleItems = group.items.filter((i) => i.visible);
          if (!visibleItems.length) return null;
          return (
            <section key={group.title}>
              <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 11, fontWeight: 700, letterSpacing: 0.6, margin: "2px 0 8px" }}>
                {group.title}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {visibleItems.map((i) => {
                  const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
                  return (
                      <Link key={i.href + i.label} href={i.href} style={itemStyle(active, b)}>
                      {i.label}
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>
      <div
        style={{
          marginTop: "auto",
          borderTop: "1px solid rgba(255,255,255,0.12)",
          padding: 14,
          display: "grid",
          gap: 8,
        }}
      >
        {loggedIn ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: b.secondary,
                  color: b.white,
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 700,
                }}
              >
                {(displayName[0] ?? "U").toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: b.white, fontWeight: 600, lineHeight: 1.3 }}>{displayName}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.72)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{email}</div>
              </div>
            </div>
            <Link href="/settings" style={itemStyle(pathname === "/settings" || pathname.startsWith("/settings/"), b)}>Settings</Link>
            <button
              type="button"
              onClick={() => void onLogout()}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.24)",
                background: "transparent",
                color: b.white,
                cursor: "pointer",
              }}
            >
              Logout
            </button>
          </>
        ) : (
          <>
            <Link href="/login" style={itemStyle(pathname === "/login", b)}>Sign in</Link>
            <Link href="/book/public" style={itemStyle(pathname === "/book/public", b)}>Visitor booking</Link>
          </>
        )}
      </div>
    </>
  );

  return (
    <>
      <aside
        style={{
          width: 270,
          minHeight: "100vh",
          background: b.sidebar,
          position: "sticky",
          top: 0,
          display: "none",
          flexDirection: "column",
        }}
        className="vw-sidebar-desktop"
      >
        {navBody}
      </aside>

      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          background: b.sidebar,
          borderBottom: "1px solid rgba(255,255,255,0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
        }}
        className="vw-sidebar-mobile-top"
      >
        <img src={brand.logo_white_url ?? brand.logo_url ?? ""} alt={brand.brand_name} style={{ height: 24, width: "auto" }} />
        <button
          type="button"
          onClick={() => setMobileOpen((s) => !s)}
          style={{
            border: "1px solid rgba(255,255,255,0.35)",
            background: "transparent",
            color: b.white,
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Menu
        </button>
      </header>
      {mobileOpen ? (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 39, background: "rgba(0,0,0,0.35)" }}
          onClick={() => setMobileOpen(false)}
        >
          <aside
            style={{ width: 288, maxWidth: "86vw", height: "100%", background: b.sidebar, display: "flex", flexDirection: "column" }}
            onClick={(e) => e.stopPropagation()}
          >
            {navBody}
          </aside>
        </div>
      ) : null}
      <style>{`
        .vw-sidebar-mobile-top { display: flex; }
        @media (min-width: 961px) {
          .vw-sidebar-desktop { display: flex !important; }
          .vw-sidebar-mobile-top { display: none !important; }
        }
      `}</style>
    </>
  );
}
