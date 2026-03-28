"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useState, type CSSProperties } from "react";
import type { CmsMarketingLocale } from "@/lib/cms2/marketing-locales";
import type { CmsPublicUi } from "@/lib/cms2/public-ui";
import { tx } from "@/lib/cms2/public-ui";
import type { PublicOrgPayload } from "@/lib/cms2/types";
import type { CmsTheme } from "@/lib/cms2/types";
import { Cms2LanguageSwitcher } from "./Cms2LanguageSwitcher";

/** Breakpoint: below this width, primary nav collapses into hamburger (single-row bar). */
const NAV_MOBILE_MAX = 1099;

const NAV_LINK_HOVER = "#1a4a4a";

/** Public header nav link (Etusivu, Tilat, …) */
const NAV_LINK_STYLE: CSSProperties = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: "14px",
  fontWeight: 400,
  letterSpacing: "-0.01em",
  color: "#2c3e3e",
};

/** Kirjaudu / Varaa tila */
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

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(250, 249, 246, 0.85)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: `1px solid ${theme.border}`,
      }}
    >
      <div
        className="cms2-header-row"
        style={{
          position: "relative",
          maxWidth: 1120,
          margin: "0 auto",
          padding: "14px 22px",
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
          }}
        >
          {org.logoUrl ? (
            <Image
              src={org.logoUrl}
              alt=""
              width={200}
              height={50}
              style={{ width: "auto", height: "40px" }}
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
                }}
              />
              {org.brandName}
            </>
          )}
        </Link>
        <nav
          className={`cms2-nav-main cms2-nav-links ${open ? "cms2-nav-main-open" : ""}`}
          style={{
            flex: 1,
            minWidth: 0,
          }}
        >
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="cms2-nav-link"
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
          <Suspense fallback={null}>
            <Cms2LanguageSwitcher theme={theme} currentLocale={locale} ui={ui} />
          </Suspense>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={{
              display: "none",
              padding: "8px 12px",
              borderRadius: 10,
              border: `1px solid ${theme.border}`,
              background: theme.surface,
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              color: theme.petrol,
            }}
            className="cms2-nav-toggle"
            aria-label={tx(ui, "header.menu")}
            aria-expanded={open}
          >
            ☰
          </button>
          <Link
            href={`/login?redirect=${encodeURIComponent(loginRedirect || "/portal")}`}
            className="cms2-header-login"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
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
      <style>{`
        .cms2-header-row {
          flex-wrap: nowrap !important;
        }
        .cms2-nav-main.cms2-nav-links {
          flex-wrap: nowrap;
          overflow: hidden;
        }
        .cms2-nav-main {
          display: none;
          position: absolute;
          left: 0;
          right: 0;
          top: 100%;
          flex-direction: column;
          background: rgba(250, 249, 246, 0.96);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid ${theme.border};
          padding: 12px;
          gap: 4px;
          box-shadow: 0 12px 24px rgba(0,0,0,0.08);
          z-index: 45;
        }
        .cms2-nav-main a {
          white-space: nowrap;
        }
        .cms2-nav-main-open { display: flex !important; }
        @media (min-width: ${NAV_MOBILE_MAX + 1}px) {
          .cms2-nav-main {
            display: flex !important;
            position: static !important;
            flex-direction: row !important;
            flex-wrap: nowrap !important;
            align-items: center;
            justify-content: center;
            background: transparent !important;
            border: none !important;
            padding: 0 !important;
            box-shadow: none !important;
            overflow: hidden;
            gap: 2px;
          }
          .cms2-nav-toggle { display: none !important; }
        }
        @media (max-width: ${NAV_MOBILE_MAX}px) {
          .cms2-nav-toggle { display: inline-flex !important; align-items: center; justify-content: center; }
          .cms2-header-login,
          .cms2-header-cta {
            padding: 8px 12px !important;
            font-size: 14px !important;
          }
        }
        .cms2-nav-main a.cms2-nav-link:hover {
          background: transparent;
          color: ${NAV_LINK_HOVER};
          font-weight: 500;
        }
      `}</style>
    </header>
  );
}
