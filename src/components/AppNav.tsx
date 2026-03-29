"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { useBrand } from "@/components/BrandProvider";
import { getSupabaseClient } from "@/lib/supabase/browser";
import {
  computeAppNavFlagsFromRoles,
  LOGGED_OUT_APP_NAV_INITIAL,
  type AppNavInitialState,
} from "@/lib/nav/nav-flags";

const navFont = "var(--font-dm-sans), sans-serif";

const itemStyle = (active: boolean, b: { white: string; secondary: string }): CSSProperties => ({
  display: "block",
  padding: "10px 12px",
  borderRadius: 8,
  textDecoration: "none",
  fontFamily: navFont,
  fontSize: 14,
  fontWeight: active ? 500 : 400,
  color: b.white,
  background: active ? b.secondary : "transparent",
  transition: "background 120ms ease",
});

function navLinkIsActive(pathname: string, href: string): boolean {
  if (href === "/super-admin") {
    return pathname === "/super-admin" || pathname.startsWith("/super-admin/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

type AppNavProps = {
  /** From server layout (SSR session); avoids empty sidebar before hydration. */
  appNavInitial: AppNavInitialState;
};

export default function AppNav({ appNavInitial }: AppNavProps) {
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(appNavInitial.loggedIn);
  const [displayName, setDisplayName] = useState(appNavInitial.displayName);
  const [email, setEmail] = useState(appNavInitial.email);
  const [isSuperAdmin, setIsSuperAdmin] = useState(appNavInitial.isSuperAdmin);
  const [showManageBookings, setShowManageBookings] = useState(appNavInitial.showManageBookings);
  const [showOwnerDashboard, setShowOwnerDashboard] = useState(appNavInitial.showOwnerDashboard);
  const [showRoomsNav, setShowRoomsNav] = useState(appNavInitial.showRoomsNav);
  const [showCrmNav, setShowCrmNav] = useState(appNavInitial.showCrmNav);
  const [showReportsNav, setShowReportsNav] = useState(appNavInitial.showReportsNav);
  const [showMarketingNav, setShowMarketingNav] = useState(appNavInitial.showMarketingNav);

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
        setDisplayName(LOGGED_OUT_APP_NAV_INITIAL.displayName);
        setEmail(LOGGED_OUT_APP_NAV_INITIAL.email);
        setIsSuperAdmin(false);
        setShowManageBookings(false);
        setShowOwnerDashboard(false);
        setShowRoomsNav(false);
        setShowCrmNav(false);
        setShowReportsNav(false);
        setShowMarketingNav(false);
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
      const flags = computeAppNavFlagsFromRoles(roles);
      setIsSuperAdmin(flags.isSuperAdmin);
      setShowReportsNav(flags.showReportsNav);
      setShowManageBookings(flags.showManageBookings);
      setShowOwnerDashboard(flags.showOwnerDashboard);
      setShowRoomsNav(flags.showRoomsNav);
      setShowCrmNav(flags.showCrmNav);
      setShowMarketingNav(flags.showMarketingNav);
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

  const sections: Array<{ title: string; items: Array<{ href: string; label: string; visible: boolean }> }> = [
    {
      title: "OVERVIEW",
      items: [
        { href: "/dashboard", label: "Dashboard", visible: showOwnerDashboard },
        { href: "/dashboard", label: "Properties", visible: loggedIn },
        { href: "/offices", label: "Offices", visible: loggedIn && showRoomsNav },
        { href: "/meeting-rooms", label: "Meeting rooms", visible: loggedIn && showRoomsNav },
        { href: "/venues", label: "Venues", visible: loggedIn && showRoomsNav },
        { href: "/coworking", label: "Coworking / Hot desks", visible: loggedIn && showRoomsNav },
        { href: "/virtual-office", label: "Virtual Office", visible: loggedIn && showRoomsNav },
        { href: "/rooms", label: "Rooms (all products)", visible: loggedIn && showRoomsNav },
        { href: "/rooms/furniture", label: "Furniture", visible: loggedIn && showRoomsNav },
        { href: "/floor-plans", label: "🏗️ Floor Plans", visible: loggedIn && showRoomsNav },
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
      title: "MARKETING",
      items: [
        { href: "/marketing", label: "📊 Marketing dashboard", visible: loggedIn && showMarketingNav },
        { href: "/marketing/campaigns", label: "📋 Campaigns", visible: loggedIn && showMarketingNav },
        { href: "/marketing/email", label: "📧 Email campaigns", visible: loggedIn && showMarketingNav },
        { href: "/marketing/sms", label: "💬 SMS campaigns", visible: loggedIn && showMarketingNav },
        { href: "/marketing/social", label: "📱 Social media", visible: loggedIn && showMarketingNav },
        { href: "/marketing/events", label: "🎉 Events", visible: loggedIn && showMarketingNav },
        { href: "/marketing/offers", label: "🏷️ Offers & discounts", visible: loggedIn && showMarketingNav },
        { href: "/marketing/referrals", label: "👥 Referrals", visible: loggedIn && showMarketingNav },
        { href: "/marketing/analytics", label: "📈 Analytics", visible: loggedIn && showMarketingNav },
      ],
    },
    {
      title: "WORK",
      items: [{ href: "/tasks", label: "Tasks", visible: loggedIn }],
    },
    {
      title: "FINANCE",
      items: [
        { href: "/bookings/manage", label: "Invoices", visible: loggedIn && showManageBookings },
        { href: "/reports", label: "Reports", visible: loggedIn && showReportsNav },
        { href: "/budget", label: "Budget & Forecast", visible: loggedIn && showReportsNav },
      ],
    },
    {
      title: "ADMIN",
      items: [
        { href: "/settings", label: "Settings", visible: loggedIn },
        { href: "/super-admin", label: "Super Admin", visible: loggedIn && isSuperAdmin },
      ],
    },
  ];

  const navScroll = (
    <>
      <div style={{ padding: 18, borderBottom: "1px solid rgba(255,255,255,0.12)", flexShrink: 0 }}>
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
              <div
                style={{
                  color: "rgba(255,255,255,0.72)",
                  fontFamily: navFont,
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: 0.6,
                  margin: "2px 0 8px",
                }}
              >
                {group.title}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {visibleItems.map((i) => {
                  const active = navLinkIsActive(pathname ?? "", i.href);
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
    </>
  );

  const navFooter = (
    <div
      style={{
        borderTop: "1px solid rgba(255,255,255,0.12)",
        padding: 14,
        display: "grid",
        gap: 8,
        flexShrink: 0,
        background: b.sidebar,
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
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.72)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {email}
              </div>
            </div>
          </div>
          <Link href="/settings" style={itemStyle(pathname === "/settings" || pathname.startsWith("/settings/"), b)}>
            Settings
          </Link>
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
          <Link href="/login" style={itemStyle(pathname === "/login", b)}>
            Sign in
          </Link>
          <Link href="/book/public" style={itemStyle(pathname === "/book/public", b)}>
            Visitor booking
          </Link>
        </>
      )}
    </div>
  );

  return (
    <>
      <aside
        style={{
          width: 270,
          minHeight: "100vh",
          maxHeight: "100vh",
          background: b.sidebar,
          position: "sticky",
          top: 0,
          alignSelf: "flex-start",
          display: "none",
          flexDirection: "column",
          fontFamily: navFont,
          overflow: "hidden",
        }}
        className="vw-sidebar-desktop"
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {navScroll}
        </div>
        {navFooter}
      </aside>

      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          background: b.sidebar,
          borderBottom: "1px solid rgba(255,255,255,0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          paddingTop: "max(10px, env(safe-area-inset-top))",
        }}
        className="vw-sidebar-mobile-top"
      >
        <img src={brand.logo_white_url ?? brand.logo_url ?? ""} alt={brand.brand_name} style={{ height: 24, width: "auto" }} />
        <button
          type="button"
          onClick={() => setMobileOpen((s) => !s)}
          aria-expanded={mobileOpen}
          aria-label="Open menu"
          style={{
            border: "1px solid rgba(255,255,255,0.35)",
            background: "transparent",
            color: b.white,
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 18,
            lineHeight: 1,
            fontFamily: navFont,
            fontWeight: 400,
            cursor: "pointer",
          }}
        >
          ☰
        </button>
      </header>
      {mobileOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            top: "var(--vw-mobile-header-h, 52px)",
            zIndex: 90,
            display: "flex",
            flexDirection: "row",
            alignItems: "stretch",
          }}
          role="presentation"
        >
          <aside
            style={{
              width: "min(300px, 88vw)",
              maxWidth: 300,
              height: "100%",
              background: b.sidebar,
              display: "flex",
              flexDirection: "column",
              fontFamily: navFont,
              overflow: "hidden",
              boxShadow: "4px 0 24px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                WebkitOverflowScrolling: "touch",
                overscrollBehavior: "contain",
              }}
            >
              {navScroll}
            </div>
            {navFooter}
          </aside>
          <button
            type="button"
            aria-label="Close menu"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              cursor: "pointer",
              background: "rgba(0,0,0,0.45)",
              padding: 0,
            }}
            onClick={() => setMobileOpen(false)}
          />
        </div>
      ) : null}
      <style>{`
        .vw-sidebar-mobile-top { display: flex; }
        @media (min-width: 768px) {
          .vw-sidebar-desktop { display: flex !important; }
          .vw-sidebar-mobile-top { display: none !important; }
        }
      `}</style>
    </>
  );
}
