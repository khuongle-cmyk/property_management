"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { languages, type CmsMarketingLocale } from "@/lib/cms2/marketing-locales";
import type { CmsPublicUi } from "@/lib/cms2/public-ui";
import { tx } from "@/lib/cms2/public-ui";
import type { CmsTheme } from "@/lib/cms2/types";

const PETROL = "#1a4a4a";
const CREAM_HOVER = "#f4f1ec";

const FLAG_URLS: Record<string, string> = {
  fi: "https://flagcdn.com/w40/fi.png",
  en: "https://flagcdn.com/w40/gb.png",
  sv: "https://flagcdn.com/w40/se.png",
  no: "https://flagcdn.com/w40/no.png",
  da: "https://flagcdn.com/w40/dk.png",
  es: "https://flagcdn.com/w40/es.png",
  fr: "https://flagcdn.com/w40/fr.png",
};

/** Language dropdown rows (matches public header typography) */
const LANG_ITEM_STYLE = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: "14px",
  fontWeight: 400,
  color: "#2c3e3e",
} as const;

export function Cms2LanguageSwitcher({
  theme: _theme,
  currentLocale,
  ui,
  variant = "dropdown",
  onNavigate,
}: {
  theme: CmsTheme;
  currentLocale: CmsMarketingLocale;
  ui: CmsPublicUi;
  /** `drawer`: full-width stacked links for mobile menu (no trigger). */
  variant?: "dropdown" | "drawer";
  /** Called when a language is chosen (drawer: close parent menu). */
  onNavigate?: () => void;
}) {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = languages.find((o) => o.code === currentLocale) ?? languages[0];

  function hrefFor(lang: CmsMarketingLocale): string {
    const p = new URLSearchParams(searchParams.toString());
    if (lang === "fi") {
      p.delete("lang");
    } else {
      p.set("lang", lang);
    }
    const qs = p.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ariaLabel = `${tx(ui, "lang.title")}: ${current.name}`;

  if (variant === "drawer") {
    return (
      <div className="cms2-lang-drawer-flags" style={{ width: "100%" }}>
        <div
          style={{
            fontSize: 12,
            color: "rgba(44, 62, 62, 0.55)",
            fontFamily: "'DM Sans', sans-serif",
            marginBottom: 10,
            fontWeight: 400,
          }}
        >
          {tx(ui, "lang.title")}
        </div>
        <div
          role="list"
          style={{
            display: "flex",
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
          }}
        >
          {languages.map((opt) => {
            const active = currentLocale === opt.code;
            return (
              <Link
                key={opt.code}
                href={hrefFor(opt.code)}
                scroll={false}
                role="listitem"
                title={opt.name}
                aria-label={opt.name}
                aria-current={active ? "true" : undefined}
                onClick={() => onNavigate?.()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 40,
                  height: 32,
                  borderRadius: 8,
                  border: active ? `2px solid ${PETROL}` : "2px solid transparent",
                  boxSizing: "border-box",
                  textDecoration: "none",
                  padding: 2,
                  background: active ? "rgba(26, 74, 74, 0.06)" : "transparent",
                  transition: "border-color 0.15s ease, background 0.15s ease",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={FLAG_URLS[opt.code]}
                  alt=""
                  width={28}
                  height={21}
                  style={{
                    borderRadius: 4,
                    objectFit: "cover",
                    display: "block",
                    width: 28,
                    height: 21,
                  }}
                />
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="cms2-lang-switcher" style={{ position: "relative", zIndex: 60 }}>
      <style>{`
        .cms2-lang-switcher ul.cms2-lang-menu {
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 8px 28px rgba(26, 74, 74, 0.12);
          border: 1px solid rgba(26, 74, 74, 0.08);
          padding: 0;
          box-sizing: border-box;
        }
        .cms2-lang-switcher a.cms2-lang-option:hover {
          background: ${CREAM_HOVER};
        }
        .cms2-lang-switcher .cms2-lang-trigger-btn {
          min-width: 44px;
          min-height: 44px;
        }
        @media (min-width: 768px) {
          .cms2-lang-switcher .cms2-lang-trigger-btn {
            min-width: unset;
            min-height: unset;
          }
        }
      `}</style>
      <button
        type="button"
        id="cms2-lang-trigger"
        className="cms2-lang-trigger-btn"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="cms2-lang-menu"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          padding: "6px 10px",
          borderRadius: "8px",
          border: "1.5px solid rgba(26,74,74,0.12)",
          background: "transparent",
          cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={FLAG_URLS[currentLocale]}
          alt=""
          width={20}
          height={15}
          style={{ borderRadius: "2px", objectFit: "cover" }}
        />
        <span style={{ fontSize: "12px", color: "#2c3e3e", lineHeight: 1 }} aria-hidden>
          ▼
        </span>
      </button>

      {open ? (
        <ul
          id="cms2-lang-menu"
          className="cms2-lang-menu"
          role="listbox"
          aria-labelledby="cms2-lang-trigger"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            minWidth: "140px",
            width: "auto",
            margin: 0,
            listStyle: "none",
          }}
        >
          {languages.map((opt) => {
            const active = currentLocale === opt.code;
            return (
              <li key={opt.code} role="option" aria-selected={active}>
                <Link
                  href={hrefFor(opt.code)}
                  scroll={false}
                  className="cms2-lang-option"
                  onClick={() => setOpen(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px 16px",
                    borderRadius: 8,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    ...LANG_ITEM_STYLE,
                    fontWeight: active ? 500 : 400,
                    color: active ? PETROL : LANG_ITEM_STYLE.color,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={FLAG_URLS[opt.code]}
                    alt={opt.name}
                    width={20}
                    height={15}
                    style={{
                      borderRadius: "2px",
                      display: "inline-block",
                      verticalAlign: "middle",
                      objectFit: "cover",
                    }}
                  />
                  <span>{opt.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
