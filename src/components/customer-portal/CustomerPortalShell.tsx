"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useBrand } from "@/components/BrandProvider";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { CustomerPortalProvider, useCustomerPortal } from "@/context/CustomerPortalContext";
import { clearAuthCookies } from "@/lib/auth/user-type-cookie";

const PETROL = "#0D4F4F";

function IconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function IconCalendarPlus() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function IconFileText() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}
function IconBuilding() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 21h18" />
      <path d="M5 21V7l8-4v18" />
      <path d="M19 21V11l-6-4" />
      <line x1="9" y1="9" x2="9" y2="9.01" />
      <line x1="9" y1="12" x2="9" y2="12.01" />
      <line x1="9" y1="15" x2="9" y2="15.01" />
      <line x1="9" y1="18" x2="9" y2="18.01" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
function IconMenu() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function navLinkActive(pathname: string, href: string): boolean {
  if (href === "/portal") {
    return pathname === "/portal" || pathname === "/portal/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  icon,
  label,
  onNavigate,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  onNavigate: () => void;
}) {
  const pathname = usePathname() ?? "";
  const active = navLinkActive(pathname, href);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 8,
        textDecoration: "none",
        color: active ? "#fff" : "rgba(255,255,255,0.88)",
        background: active ? PETROL : "transparent",
        fontWeight: active ? 600 : 500,
        fontSize: 14,
      }}
    >
      {icon}
      {label}
    </Link>
  );
}

function CustomerPortalLayoutInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { brand } = useBrand();
  const { customerUser, company, loading } = useCustomerPortal();
  const [authLabel, setAuthLabel] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      const meta = user.user_metadata ?? {};
      const name = String(meta.full_name ?? meta.name ?? user.email?.split("@")[0] ?? "User");
      setAuthLabel(name);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      if (!customerUser) {
        router.replace("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, customerUser, router]);

  const displayName =
    [customerUser?.first_name, customerUser?.last_name].filter(Boolean).join(" ").trim() ||
    authLabel;
  const companyName = company?.name ?? "—";
  const isCompanyAdmin = String(customerUser?.role ?? "").toLowerCase() === "company_admin";

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function onLogout() {
    clearAuthCookies();
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const closeMobile = () => setMenuOpen(false);

  const nav = (
    <nav style={{ display: "grid", gap: 4, marginTop: 16 }}>
      <NavLink href="/portal" icon={<IconHome />} label="Dashboard" onNavigate={closeMobile} />
      <NavLink href="/portal/bookings" icon={<IconCalendar />} label="My Bookings" onNavigate={closeMobile} />
      <NavLink href="/portal/book" icon={<IconCalendarPlus />} label="Make Booking" onNavigate={closeMobile} />
      <NavLink href="/portal/invoices" icon={<IconFileText />} label="Invoices" onNavigate={closeMobile} />
      {isCompanyAdmin ? (
        <NavLink href="/portal/company" icon={<IconBuilding />} label="My Company" onNavigate={closeMobile} />
      ) : null}
      <NavLink href="/portal/profile" icon={<IconUser />} label="My Profile" onNavigate={closeMobile} />
      <button
        type="button"
        onClick={() => {
          closeMobile();
          void onLogout();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderRadius: 8,
          border: "none",
          background: "transparent",
          color: "rgba(255,255,255,0.88)",
          fontWeight: 500,
          fontSize: 14,
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <IconLogout />
        Logout
      </button>
    </nav>
  );

  const logoUrl = brand.logo_white_url ?? brand.logo_url;

  const sidebarContent = (
    <>
      <div style={{ padding: "20px 16px", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
        {logoUrl ? (
          <img src={logoUrl} alt={brand.brand_name} style={{ maxWidth: 160, height: "auto", maxHeight: 32, objectFit: "contain" }} />
        ) : (
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>VillageWorks</div>
        )}
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", marginTop: 8, lineHeight: 1.35 }}>{companyName}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginTop: 8 }}>{loading ? "…" : displayName}</div>
      </div>
      {nav}
    </>
  );

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#ffffff", color: PETROL }}>
        <p style={{ fontSize: 15 }}>Loading portal…</p>
      </div>
    );
  }

  if (!customerUser) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#ffffff", color: "#64748b" }}>
        <p style={{ fontSize: 15 }}>Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="cp-shell" style={{ display: "flex", minHeight: "100vh", background: "#ffffff", color: "#0f172a" }}>
      <aside
        style={{
          display: menuOpen ? "flex" : "none",
          flexDirection: "column",
          width: 260,
          flexShrink: 0,
          background: PETROL,
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 40,
          overflowY: "auto",
        }}
        className="cp-sidebar-mobile"
      >
        {sidebarContent}
      </aside>

      <aside
        style={{
          display: "none",
          flexDirection: "column",
          width: 260,
          flexShrink: 0,
          background: PETROL,
          minHeight: "100vh",
          position: "sticky",
          top: 0,
          alignSelf: "flex-start",
        }}
        className="cp-sidebar-desktop"
      >
        {sidebarContent}
      </aside>

      <style>{`
        .cp-shell .vw-btn-primary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 10px 18px;
          border-radius: 10px;
          border: none;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          background: ${PETROL};
          color: #fff;
          box-shadow: 0 2px 8px rgba(13, 79, 79, 0.2);
        }
        .cp-shell .vw-btn-primary:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .cp-shell .vw-btn-secondary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 10px 18px;
          border-radius: 10px;
          border: 1px solid rgba(13, 79, 79, 0.35);
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          background: #fff;
          color: ${PETROL};
        }
        .cp-shell .vw-input {
          font-family: inherit;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(13, 79, 79, 0.2);
          font-size: 14px;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
        .cp-main {
          width: 100%;
        }
        @media (min-width: 768px) {
          .cp-sidebar-mobile { display: none !important; }
          .cp-sidebar-desktop { display: flex !important; }
        }
        @media (max-width: 767px) {
          .cp-sidebar-desktop { display: none !important; }
        }
      `}</style>

      {menuOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 30,
            background: "rgba(0,0,0,0.35)",
            border: "none",
            cursor: "pointer",
          }}
          className="cp-overlay"
        />
      ) : null}

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", width: "100%" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            background: "#fff",
            borderBottom: "1px solid #e5e7eb",
            position: "sticky",
            top: 0,
            zIndex: 20,
          }}
          className="cp-topbar"
        >
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 8,
              borderRadius: 8,
              border: `1px solid ${PETROL}`,
              background: "#fff",
              color: PETROL,
              cursor: "pointer",
            }}
            className="cp-hamburger"
          >
            <IconMenu />
          </button>
          <style>{`
            @media (min-width: 768px) {
              .cp-hamburger { display: none !important; }
            }
          `}</style>
          <span style={{ fontSize: 15, fontWeight: 600, color: PETROL }}>Customer portal</span>
        </header>
        <main
          className="cp-main"
          style={{
            flex: 1,
            padding: "clamp(16px, 3vw, 28px) clamp(14px, 4vw, 24px) 40px",
            maxWidth: 1200,
            width: "100%",
            margin: "0 auto",
            boxSizing: "border-box",
            background: "#ffffff",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export default function CustomerPortalShell({ children }: { children: ReactNode }) {
  return (
    <CustomerPortalProvider>
      <CustomerPortalLayoutInner>{children}</CustomerPortalLayoutInner>
    </CustomerPortalProvider>
  );
}
