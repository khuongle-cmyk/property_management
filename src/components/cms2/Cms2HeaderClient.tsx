"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useState, type CSSProperties } from "react";
import type { CmsMarketingLocale } from "@/lib/cms2/marketing-locales";
import type { CmsPublicUi } from "@/lib/cms2/public-ui";
import { tx } from "@/lib/cms2/public-ui";
import type { PublicOrgPayload } from "@/lib/cms2/types";
import type { CmsTheme } from "@/lib/cms2/types";
import { Cms2LanguageSwitcher } from "./Cms2LanguageSwitcher";

/** Breakpoint: &lt; 768px = compact bar + slide-in menu panel. */
const NAV_MOBILE_MAX = 767;

const NAV_LINK_HOVER = "#1a4a4a";

const NAV_LINK_STYLE: CSSProperties = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: "14px",
  fontWeight: 400,
  letterSpacing: "-0.01em",
  color: "#2c3e3e",
};

const NAV_BTN_STYLE: CSSProperties = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: "14px",
  fontWeight: 500,
  letterSpacing: "-0.01em",
};

export function Cms2HeaderClient({
  org,
  theme,
  nav,
  basePath,
  locale,
  ui,
}: {
  org: PublicOrgPayload;
  theme: CmsTheme;
  nav: { href: string; label: string }[];
  basePath: string;
  locale: CmsMarketingLocale;
  ui: CmsPublicUi;
}) {
  const [open, setOpen] = useState(false);
  const loginRedirect = `${basePath || ""}/portal`;

  const closeMenu = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 70,
        background: "rgba(250, 249, 246, 0.85)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: `1px solid ${theme.border}`,
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      <div
        className="cms2-header-row"
        style={{
          position: "relative",
          maxWidth: 1120,
          margin: "0 auto",
          paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
          paddingRight: "max(16px, env(safe-area-inset-right, 0px))",
          paddingTop: 12,
          paddingBottom: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "nowrap",
          minWidth: 0,
        }}
      >
        <Link
          href={basePath ? `${basePath}/` : "/"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontWeight: 700,
            fontSize: "1.05rem",
            color: theme.petrol,
            textDecoration: "none",
            letterSpacing: "-0.02em",
            flexShrink: 0,
            minWidth: 0,
          }}
        >
          {org.logoUrl ? (
            <Image
              src={org.logoUrl}
              alt={org.brandName || "Logo"}
              width={160}
              height={40}
              className="cms2-header-logo-img"
              style={{
                width: "auto",
                maxWidth: "min(200px, 55vw)",
                objectFit: "contain",
                verticalAlign: "middle",
              }}
              unoptimized
            />
          ) : (
            <>
              <span
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: `linear-gradient(135deg, ${theme.petrol}, ${theme.teal})`,
                  flexShrink: 0,
                }}
              />
              <span className="cms2-header-brand-text" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {org.brandName}
              </span>
            </>
          )}
        </Link>

        <nav
          className="cms2-nav-inline-desktop"
          aria-label="Main"
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            flexWrap: "nowrap",
            gap: 2,
            overflow: "hidden",
          }}
        >
          {nav.map((item) => (
            <Link
              key={item.href + item.label}
              href={item.href}
              className="cms2-nav-link-desktop"
              style={{
                ...NAV_LINK_STYLE,
                textDecoration: "none",
                padding: "8px 10px",
                borderRadius: 10,
                whiteSpace: "nowrap",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div
          className="cms2-header-actions"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "nowrap",
            flexShrink: 0,
            minWidth: 0,
          }}
        >
          <div className="cms2-lang-desktop">
            <Suspense fallback={null}>
              <Cms2LanguageSwitcher theme={theme} currentLocale={locale} ui={ui} />
            </Suspense>
          </div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="cms2-nav-toggle"
            aria-label={tx(ui, "header.menu")}
            aria-expanded={open}
            style={{
              display: "none",
              minWidth: 44,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
              padding: "0 10px",
              borderRadius: 10,
              border: `1px solid ${theme.border}`,
              background: theme.surface,
              cursor: "pointer",
              fontSize: 22,
              lineHeight: 1,
              color: theme.petrol,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            ☰
          </button>
          <Link
            href={`/login?redirect=${encodeURIComponent(loginRedirect || "/portal")}`}
            className="cms2-header-login-desktop"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 44,
              padding: "10px 14px",
              borderRadius: 10,
              textDecoration: "none",
              background: theme.surface,
              color: NAV_LINK_HOVER,
              border: `1px solid ${theme.border}`,
              whiteSpace: "nowrap",
              ...NAV_BTN_STYLE,
            }}
          >
            {tx(ui, "header.login")}
          </Link>
          <Link
            href={`${basePath}/book`}
            className="cms2-header-cta"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 44,
              padding: "10px 14px",
              borderRadius: 10,
              textDecoration: "none",
              background: theme.petrol,
              color: "#fff",
              boxShadow: "0 4px 14px rgba(26, 92, 90, 0.35)",
              whiteSpace: "nowrap",
              ...NAV_BTN_STYLE,
            }}
          >
            {tx(ui, "header.bookRoom")}
          </Link>
        </div>
      </div>

      <button
        type="button"
        className={`cms2-mobile-menu-backdrop${open ? " cms2-mobile-menu-backdrop--open" : ""}`}
        aria-label="Close menu"
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        onClick={closeMenu}
      />
      <div
        className={`cms2-mobile-menu-drawer${open ? " cms2-mobile-menu-drawer--open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label={tx(ui, "header.menu")}
      >
        <button
          type="button"
          className="cms2-mobile-menu-close"
          aria-label="Close menu"
          onClick={closeMenu}
        >
          ×
        </button>
        <div className="cms2-mobile-menu-body">
          <nav className="cms2-mobile-menu-nav" aria-label="Main">
            {nav.map((item) => (
              <Link key={item.href + item.label} href={item.href} onClick={closeMenu} className="cms2-mobile-nav-link">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="cms2-mobile-menu-lang">
            <Suspense fallback={null}>
              <Cms2LanguageSwitcher
                variant="drawer"
                theme={theme}
                currentLocale={locale}
                ui={ui}
                onNavigate={closeMenu}
              />
            </Suspense>
          </div>
        </div>
        <div className="cms2-mobile-menu-footer">
          <Link
            href={`/login?redirect=${encodeURIComponent(loginRedirect || "/portal")}`}
            onClick={closeMenu}
            className="cms2-mobile-btn-ghost"
          >
            {tx(ui, "header.login")}
          </Link>
          <Link href={`${basePath}/book`} onClick={closeMenu} className="cms2-mobile-btn-primary">
            {tx(ui, "header.bookRoom")}
          </Link>
        </div>
      </div>

      <style>{`
        .cms2-header-logo-img {
          height: 32px !important;
          width: auto !important;
          max-height: 32px !important;
          object-fit: contain !important;
        }
        @media (min-width: 768px) {
          .cms2-header-logo-img {
            height: 40px !important;
            max-height: 40px !important;
          }
          .cms2-nav-inline-desktop {
            display: flex !important;
          }
          .cms2-lang-desktop {
            display: block !important;
          }
          .cms2-nav-toggle {
            display: none !important;
          }
          .cms2-header-login-desktop {
            display: inline-flex !important;
          }
          .cms2-mobile-menu-backdrop,
          .cms2-mobile-menu-drawer {
            display: none !important;
          }
        }
        @media (max-width: ${NAV_MOBILE_MAX}px) {
          .cms2-nav-inline-desktop {
            display: none !important;
          }
          .cms2-lang-desktop {
            display: none !important;
          }
          .cms2-header-login-desktop {
            display: none !important;
          }
          .cms2-nav-toggle {
            display: inline-flex !important;
          }
          .cms2-header-cta {
            padding: 10px 12px !important;
            font-size: 14px !important;
            max-width: 42vw;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .cms2-mobile-menu-backdrop {
            display: block !important;
            position: fixed !important;
            inset: 0 !important;
            z-index: 90 !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            background: rgba(0, 0, 0, 0.4) !important;
            cursor: pointer !important;
            -webkit-tap-highlight-color: transparent;
            opacity: 0 !important;
            pointer-events: none !important;
            transition: opacity 0.3s ease !important;
          }
          .cms2-mobile-menu-backdrop--open {
            opacity: 1 !important;
            pointer-events: auto !important;
          }
          .cms2-mobile-menu-drawer {
            display: flex !important;
            flex-direction: column !important;
            align-items: stretch !important;
            position: fixed !important;
            top: 0 !important;
            right: 0 !important;
            left: auto !important;
            width: 280px !important;
            max-width: min(280px, 92vw) !important;
            height: 100vh !important;
            height: 100dvh !important;
            box-sizing: border-box !important;
            padding: 80px 24px max(40px, env(safe-area-inset-bottom, 0px)) !important;
            padding-top: max(80px, calc(56px + env(safe-area-inset-top, 0px))) !important;
            background: #ffffff !important;
            z-index: 91 !important;
            box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12) !important;
            transform: translateX(100%) !important;
            transition: transform 0.3s ease !important;
            pointer-events: none !important;
            overflow: hidden !important;
            -webkit-tap-highlight-color: transparent;
          }
          .cms2-mobile-menu-drawer--open {
            transform: translateX(0) !important;
            pointer-events: auto !important;
          }
          .cms2-mobile-menu-close {
            position: absolute !important;
            top: max(16px, env(safe-area-inset-top, 0px)) !important;
            right: 16px !important;
            z-index: 2 !important;
            width: 44px !important;
            height: 44px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            border: none !important;
            background: transparent !important;
            cursor: pointer !important;
            font-size: 28px !important;
            line-height: 1 !important;
            color: #2c3e3e !important;
            padding: 0 !important;
            border-radius: 10px !important;
            -webkit-tap-highlight-color: transparent;
          }
          .cms2-mobile-menu-body {
            flex: 1 !important;
            min-height: 0 !important;
            overflow-y: auto !important;
            -webkit-overflow-scrolling: touch !important;
            overscroll-behavior: contain !important;
          }
          .cms2-mobile-menu-nav {
            display: flex !important;
            flex-direction: column !important;
            align-items: stretch !important;
          }
          .cms2-mobile-nav-link {
            display: block !important;
            font-family: 'DM Sans', sans-serif !important;
            font-size: 16px !important;
            font-weight: 400 !important;
            color: #2c3e3e !important;
            text-decoration: none !important;
            padding: 12px 0 !important;
            border-bottom: 1px solid #f0f0f0 !important;
            text-transform: none !important;
            -webkit-tap-highlight-color: transparent;
          }
          .cms2-mobile-menu-lang {
            margin-top: 20px !important;
            padding-top: 4px !important;
          }
          .cms2-mobile-menu-footer {
            flex-shrink: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 10px !important;
            padding-top: 20px !important;
            margin-top: auto !important;
          }
          .cms2-mobile-btn-ghost {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 100% !important;
            box-sizing: border-box !important;
            padding: 12px 16px !important;
            border-radius: 10px !important;
            border: 1px solid ${theme.border} !important;
            background: ${theme.surface} !important;
            color: ${NAV_LINK_HOVER} !important;
            font-family: 'DM Sans', sans-serif !important;
            font-size: 15px !important;
            font-weight: 400 !important;
            text-decoration: none !important;
            -webkit-tap-highlight-color: transparent;
          }
          .cms2-mobile-btn-primary {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 100% !important;
            box-sizing: border-box !important;
            padding: 12px 16px !important;
            border-radius: 10px !important;
            border: none !important;
            background: ${theme.petrol} !important;
            color: #fff !important;
            font-family: 'DM Sans', sans-serif !important;
            font-size: 15px !important;
            font-weight: 600 !important;
            text-decoration: none !important;
            box-shadow: 0 4px 14px rgba(26, 92, 90, 0.35) !important;
            -webkit-tap-highlight-color: transparent;
          }
        }
        .cms2-nav-link-desktop:hover {
          color: ${NAV_LINK_HOVER};
          font-weight: 500;
        }
      `}</style>
    </header>
  );
}
