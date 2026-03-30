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
const SIDEBAR_W = 220;
const COLLAPSE_STORAGE_KEY = "vw-sidebar-collapsed";

type NavItem = { href: string; label: string; visible: boolean };

function itemStyle(active: boolean, b: { white: string; secondary: string }): CSSProperties {
  return {
    display: "block",
    padding: "6px 12px",
    borderRadius: 6,
    textDecoration: "none",
    fontFamily: navFont,
    fontSize: 13,
    fontWeight: active ? 500 : 400,
    color: b.white,
    background: active ? b.secondary : "transparent",
    transition: "background 120ms ease",
  };
}

const sectionLabelStyle: CSSProperties = {
  color: "rgba(255,255,255,0.72)",
  fontFamily: navFont,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: 0.08,
  textTransform: "uppercase",
  padding: "4px 12px",
};

function navLinkIsActive(pathname: string, href: string): boolean {
  if (href === "/super-admin") {
    return pathname === "/super-admin" || pathname.startsWith("/super-admin/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function loadCollapsedFromStorage(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as unknown;
    return typeof p === "object" && p !== null && !Array.isArray(p) ? (p as Record<string, boolean>) : {};
  } catch {
    return {};
  }
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
  const [, setEmail] = useState(appNavInitial.email);
  const [isSuperAdmin, setIsSuperAdmin] = useState(appNavInitial.isSuperAdmin);
  const [showOwnerDashboard, setShowOwnerDashboard] = useState(appNavInitial.showOwnerDashboard);
  const [showRoomsNav, setShowRoomsNav] = useState(appNavInitial.showRoomsNav);
  const [showCrmNav, setShowCrmNav] = useState(appNavInitial.showCrmNav);
  const [showReportsNav, setShowReportsNav] = useState(appNavInitial.showReportsNav);
  const [showMarketingNav, setShowMarketingNav] = useState(appNavInitial.showMarketingNav);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsed(loadCollapsedFromStorage());
  }, []);

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

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  async function onLogout() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  function toggleSection(sectionId: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [sectionId]: !prev[sectionId] };
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const overviewItems: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", visible: showOwnerDashboard },
    { href: "/properties", label: "Properties", visible: loggedIn },
  ];

  const spacesItems: NavItem[] = [
    { href: "/offices", label: "Offices", visible: loggedIn && showRoomsNav },
    { href: "/meeting-rooms", label: "Meeting rooms", visible: loggedIn && showRoomsNav },
    { href: "/venues", label: "Venues", visible: loggedIn && showRoomsNav },
    { href: "/coworking", label: "Coworking / Hot desks", visible: loggedIn && showRoomsNav },
    { href: "/virtual-office", label: "Virtual Office", visible: loggedIn && showRoomsNav },
    { href: "/rooms", label: "Rooms (all products)", visible: loggedIn && showRoomsNav },
    { href: "/rooms/furniture", label: "Furniture", visible: loggedIn && showRoomsNav },
  ];

  const toolsItems: NavItem[] = [{ href: "/floor-plans", label: "Floor planner", visible: loggedIn && showRoomsNav }];

  const bookingsItems: NavItem[] = [
    { href: "/bookings/calendar", label: "Calendar", visible: loggedIn },
    { href: "/bookings/new", label: "Make a Booking", visible: loggedIn },
    { href: "/bookings/my", label: "My Bookings", visible: loggedIn },
  ];

  const salesItems: NavItem[] = [
    { href: "/crm", label: "Pipeline", visible: loggedIn && showCrmNav },
  ];

  const crmItems: NavItem[] = [
    { href: "/crm/contacts", label: "Contacts", visible: loggedIn && showCrmNav },
  ];

  const workItems: NavItem[] = [{ href: "/tasks", label: "Tasks", visible: loggedIn }];

  const financeItems: NavItem[] = [
    { href: "/reports", label: "Reports", visible: loggedIn && showReportsNav },
    { href: "/budget", label: "Budget & Forecast", visible: loggedIn && showReportsNav },
  ];

  const marketingItems: NavItem[] = [
    { href: "/marketing", label: "Marketing dashboard", visible: loggedIn && showMarketingNav },
  ];

  const adminItems: NavItem[] = [
    { href: "/settings", label: "Settings", visible: loggedIn },
    { href: "/super-admin", label: "Super Admin", visible: loggedIn && isSuperAdmin },
  ];

  /** Section order: Overview + Admin are static; these match product nav spec. */
  const collapsibleSections: Array<{ id: string; title: string; items: NavItem[] }> = [
    { id: "sales", title: "Sales", items: salesItems },
    { id: "crm", title: "CRM", items: crmItems },
    { id: "marketing", title: "Marketing", items: marketingItems },
    { id: "spaces", title: "Spaces", items: spacesItems },
    { id: "bookings", title: "Bookings", items: bookingsItems },
    { id: "work", title: "Work", items: workItems },
    { id: "finance", title: "Finance", items: financeItems },
    { id: "tools", title: "Tools", items: toolsItems },
  ];

  function renderNavLinks(items: NavItem[]) {
    const visible = items.filter((i) => i.visible);
    if (!visible.length) return null;
    return (
      <div style={{ display: "grid", gap: 2 }}>
        {visible.map((i) => {
          const active = navLinkIsActive(pathname ?? "", i.href);
          return (
            <Link key={i.href + i.label} href={i.href} style={itemStyle(active, b)}>
              {i.label}
            </Link>
          );
        })}
      </div>
    );
  }

  function renderStaticSection(title: string, items: NavItem[]) {
    const links = renderNavLinks(items);
    if (!links) return null;
    return (
      <section>
        <div style={sectionLabelStyle}>{title}</div>
        {links}
      </section>
    );
  }

  function renderCollapsibleSection(id: string, title: string, items: NavItem[]) {
    const visibleItems = items.filter((i) => i.visible);
    if (!visibleItems.length) return null;
    const isCollapsed = Boolean(collapsed[id]);
    return (
      <section>
        <button
          type="button"
          onClick={() => toggleSection(id)}
          aria-expanded={!isCollapsed}
          style={{
            ...sectionLabelStyle,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            margin: 0,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "rgba(255,255,255,0.72)",
            textAlign: "left",
          }}
        >
          <span>{title}</span>
          <span
            aria-hidden
            style={{
              display: "inline-block",
              transition: "transform 0.2s ease",
              transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
              fontSize: 10,
              lineHeight: 1,
            }}
          >
            ▼
          </span>
        </button>
        {!isCollapsed ? renderNavLinks(items) : null}
      </section>
    );
  }

  const navScrollInner = (
    <>
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.12)",
          flexShrink: 0,
        }}
      >
        <img
          src={brand.logo_white_url ?? brand.logo_url ?? ""}
          alt={brand.brand_name}
          style={{
            width: "100%",
            maxWidth: 148,
            height: "auto",
            maxHeight: 36,
            objectFit: "contain",
            objectPosition: "left center",
            display: "block",
          }}
        />
      </div>
      <nav style={{ display: "grid", gap: 8, padding: "10px 0 12px" }}>
        {renderStaticSection("Overview", overviewItems)}
        {collapsibleSections.map((sec) => {
          const block = renderCollapsibleSection(sec.id, sec.title, sec.items);
          if (!block) return null;
          return (
            <div key={sec.id}>{block}</div>
          );
        })}
        {renderStaticSection("Admin", adminItems)}
      </nav>
    </>
  );

  const navFooter = (
    <div
      style={{
        borderTop: "1px solid rgba(255,255,255,0.12)",
        padding: "10px 12px",
        display: "grid",
        gap: 6,
        flexShrink: 0,
        background: b.sidebar,
      }}
    >
      {loggedIn ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: b.secondary,
                color: b.white,
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              {(displayName[0] ?? "U").toUpperCase()}
            </div>
            <div style={{ minWidth: 0, fontSize: 12, color: b.white, fontWeight: 500, lineHeight: 1.25 }}>
              {displayName}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void onLogout()}
            style={{
              textAlign: "left",
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.24)",
              background: "transparent",
              color: b.white,
              cursor: "pointer",
              fontFamily: navFont,
              fontSize: 13,
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
          width: SIDEBAR_W,
          background: b.sidebar,
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 60,
          display: "none",
          flexDirection: "column",
          fontFamily: navFont,
          overflow: "hidden",
        }}
        className="vw-sidebar-desktop"
      >
        <div className="vw-sidebar-scroll" style={{ flex: 1, minHeight: 0, WebkitOverflowScrolling: "touch" }}>
          {navScrollInner}
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
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
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

      <div
        className={`vw-mobile-nav-layer ${mobileOpen ? "vw-mobile-nav-layer--open" : ""}`}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          top: "var(--vw-mobile-header-h, 52px)",
          bottom: 0,
          zIndex: 90,
          pointerEvents: mobileOpen ? "auto" : "none",
          visibility: mobileOpen ? "visible" : "hidden",
        }}
        aria-hidden={!mobileOpen}
      >
        <button
          type="button"
          aria-label="Close menu"
          className="vw-mobile-nav-backdrop"
          style={{
            position: "absolute",
            inset: 0,
            border: "none",
            cursor: "pointer",
            padding: 0,
            margin: 0,
            background: "rgba(0,0,0,0.4)",
            opacity: 0,
            transition: "opacity 0.3s ease",
          }}
          onClick={() => setMobileOpen(false)}
        />
        <aside
          className="vw-mobile-nav-drawer"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: SIDEBAR_W,
            maxWidth: "min(220px, 88vw)",
            height: "100%",
            background: b.sidebar,
            display: "flex",
            flexDirection: "column",
            fontFamily: navFont,
            overflow: "hidden",
            boxShadow: "4px 0 24px rgba(0,0,0,0.2)",
            transform: "translateX(-100%)",
            transition: "transform 0.3s ease",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="vw-sidebar-scroll" style={{ flex: 1, minHeight: 0, WebkitOverflowScrolling: "touch" }}>
            {navScrollInner}
          </div>
          {navFooter}
        </aside>
      </div>

      <style>{`
        .vw-sidebar-mobile-top { display: flex; }
        .vw-sidebar-scroll {
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.28) transparent;
        }
        .vw-sidebar-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .vw-sidebar-scroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.28);
          border-radius: 3px;
        }
        .vw-mobile-nav-layer--open .vw-mobile-nav-backdrop {
          opacity: 1 !important;
        }
        .vw-mobile-nav-layer--open .vw-mobile-nav-drawer {
          transform: translateX(0) !important;
        }
        @media (min-width: 768px) {
          .vw-sidebar-desktop { display: flex !important; }
          .vw-sidebar-mobile-top { display: none !important; }
          .vw-mobile-nav-layer { display: none !important; }
        }
      `}</style>
    </>
  );
}
