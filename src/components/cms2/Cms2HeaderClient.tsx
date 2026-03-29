"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { CmsMarketingLocale } from "@/lib/cms2/marketing-locales";
import type { CmsPublicUi } from "@/lib/cms2/public-ui";
import { tx } from "@/lib/cms2/public-ui";
import type { PublicOrgPayload } from "@/lib/cms2/types";
import type { CmsTheme } from "@/lib/cms2/types";
import { Cms2LanguageSwitcher } from "./Cms2LanguageSwitcher";

/** Breakpoint: &lt; 768px = compact bar + full-width menu drawer. */
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

const MOBILE_MENU_LINK: CSSProperties = {
  display: "flex",
  alignItems: "center",
  minHeight: 48,
  padding: "0 4px",
  fontFamily: "'DM Sans', sans-serif",
  fontSize: 16,
  fontWeight: 400,
  color: "#2c3e3e",
  textDecoration: "none",
  width: "100%",
  boxSizing: "border-box",
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
  const headerRef = useRef<HTMLElement>(null);
  const loginRedirect = `${basePath || ""}/portal`;

  const closeMenu = () => setOpen(false);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const setVar = () => {
      document.documentElement.style.setProperty(
        "--cms2-public-header-h",
        `${Math.ceil(el.getBoundingClientRect().height)}px`,
      );
    };
    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(el);
    window.addEventListener("orientationchange", setVar);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", setVar);
    };
  }, []);

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
      ref={headerRef}
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
              alt=""
              width={200}
              height={50}
              style={{ width: "auto", height: "40px", maxWidth: "min(160px, 42vw)" }}
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

      {open ? (
        <>
          <button
            type="button"
            className="cms2-mobile-menu-backdrop"
            aria-label="Close menu"
            onClick={closeMenu}
          />
          <div
            className="cms2-mobile-menu-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={tx(ui, "header.menu")}
          >
            {nav.map((item) => (
              <Link key={item.href + item.label} href={item.href} onClick={closeMenu} style={MOBILE_MENU_LINK}>
                {item.label}
              </Link>
            ))}
            <hr
              className="cms2-mobile-menu-hr"
              style={{
                border: "none",
                borderTop: `1px solid ${theme.border}`,
                margin: "12px 0",
              }}
            />
            <Suspense fallback={null}>
              <Cms2LanguageSwitcher
                variant="drawer"
                theme={theme}
                currentLocale={locale}
                ui={ui}
                onNavigate={closeMenu}
              />
            </Suspense>
            <hr
              className="cms2-mobile-menu-hr"
              style={{
                border: "none",
                borderTop: `1px solid ${theme.border}`,
                margin: "12px 0",
              }}
            />
            <Link
              href={`/login?redirect=${encodeURIComponent(loginRedirect || "/portal")}`}
              onClick={closeMenu}
              style={{
                ...MOBILE_MENU_LINK,
                marginTop: 4,
                justifyContent: "center",
                borderRadius: 10,
                border: `1px solid ${theme.border}`,
                background: theme.surface,
                fontWeight: 600,
                color: NAV_LINK_HOVER,
              }}
            >
              {tx(ui, "header.login")}
            </Link>
            <Link
              href={`${basePath}/book`}
              onClick={closeMenu}
              style={{
                ...MOBILE_MENU_LINK,
                marginTop: 10,
                justifyContent: "center",
                borderRadius: 10,
                border: "none",
                background: theme.petrol,
                fontWeight: 600,
                color: "#fff",
                boxShadow: "0 4px 14px rgba(26, 92, 90, 0.35)",
              }}
            >
              {tx(ui, "header.bookRoom")}
            </Link>
          </div>
        </>
      ) : null}

      <style>{`
        @media (min-width: 768px) {
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
            z-index: 68 !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            background: rgba(0, 0, 0, 0.4) !important;
            cursor: pointer !important;
            -webkit-tap-highlight-color: transparent;
          }
          .cms2-mobile-menu-drawer {
            display: flex !important;
            flex-direction: column !important;
            align-items: stretch !important;
            position: fixed !important;
            left: 0 !important;
            right: 0 !important;
            top: var(--cms2-public-header-h, 68px) !important;
            width: 100vw !important;
            max-width: 100vw !important;
            box-sizing: border-box !important;
            padding: 24px !important;
            padding-bottom: max(24px, env(safe-area-inset-bottom, 0px)) !important;
            background: #ffffff !important;
            z-index: 69 !important;
            max-height: calc(100dvh - var(--cms2-public-header-h, 68px) - env(safe-area-inset-bottom, 0px)) !important;
            overflow-y: auto !important;
            -webkit-overflow-scrolling: touch !important;
            overscroll-behavior: contain !important;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.1) !important;
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
