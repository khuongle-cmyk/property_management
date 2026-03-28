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
}: {
  theme: CmsTheme;
  currentLocale: CmsMarketingLocale;
  ui: CmsPublicUi;
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
      `}</style>
      <button
        type="button"
        id="cms2-lang-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="cms2-lang-menu"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
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
