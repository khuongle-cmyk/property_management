import { DM_Sans, Instrument_Serif } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { CmsMarketingLocale } from "@/lib/cms2/marketing-locales";
import type { PublicOrgPayload } from "@/lib/cms2/types";
import { themeFromBrand } from "@/lib/cms2/types";
import type { CmsPublicUi } from "@/lib/cms2/public-ui";
import { tx } from "@/lib/cms2/public-ui";
import { Cms2HeaderClient } from "./Cms2HeaderClient";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

/** Default public homepage hero (Erottaja2) when CMS has no custom image. */
export const DEFAULT_CMS2_HERO_IMAGE_URL =
  "https://villageworks.com/wp-content/uploads/2024/08/Toimistotilat-Helsinki-Erottaja2-Erottajankatu.webp";

function splitHeadline(headline: string): { main: string; accent: string | null } {
  const idx = headline.indexOf("|");
  if (idx === -1) return { main: headline.trim(), accent: null };
  const main = headline.slice(0, idx).trim();
  const accent = headline.slice(idx + 1).trim() || null;
  return { main, accent };
}

function phoneTelHref(phone: string): string {
  const compact = phone.replace(/[\s()-]/g, "");
  return compact.startsWith("+") ? `tel:${compact}` : `tel:${compact}`;
}

/** Product marketing routes exist at site root; tenant-scoped paths for home, spaces, contact. */
function footerExploreLinks(prefix: string, ui: CmsPublicUi): { label: string; href: string }[] {
  const p = prefix || "";
  const scoped = (path: string) => (p ? `${p}${path}` : path);
  return [
    { label: tx(ui, "nav.home"), href: p ? `${p}/` : "/" },
    { label: tx(ui, "nav.spaces"), href: scoped("/spaces") },
    { label: tx(ui, "explore.meetingRooms"), href: "/meeting-rooms" },
    { label: tx(ui, "explore.venues"), href: "/venues" },
    { label: tx(ui, "explore.coworking"), href: "/coworking" },
    { label: tx(ui, "explore.virtualOffice"), href: "/virtual-office" },
    { label: tx(ui, "nav.contact"), href: scoped("/contact") },
  ];
}

const footerLinkStyle: CSSProperties = {
  color: "#e8f4f3",
  textDecoration: "none",
  display: "block",
  marginBottom: 8,
};

function Cms2HeroDashboardPreview({ theme, hint }: { theme: ReturnType<typeof themeFromBrand>; hint: string }) {
  return (
    <div
      style={{
        padding: 22,
        minHeight: 400,
        display: "flex",
        flexDirection: "column",
        gap: 18,
        background: `linear-gradient(165deg, ${theme.surface} 0%, ${theme.accentBg} 55%, #d4efec 100%)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span
              key={c}
              style={{
                width: 11,
                height: 11,
                borderRadius: "50%",
                background: c,
                boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
              }}
            />
          ))}
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: theme.muted,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Portfolio snapshot
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[
          { k: "Occupancy", v: "90%+", sub: "Network average" },
          { k: "Locations", v: "5", sub: "Helsinki metro" },
        ].map((x) => (
          <div
            key={x.k}
            style={{
              background: theme.surface,
              borderRadius: 12,
              padding: "14px 16px",
              border: `1px solid ${theme.border}`,
              boxShadow: "0 2px 12px rgba(13, 61, 59, 0.06)",
            }}
          >
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: theme.muted,
                fontWeight: 600,
              }}
            >
              {x.k}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: theme.petrolDark, marginTop: 6, lineHeight: 1 }}>{x.v}</div>
            <div style={{ fontSize: 12, color: theme.muted, marginTop: 6 }}>{x.sub}</div>
          </div>
        ))}
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 140,
          background: theme.surface,
          borderRadius: 12,
          border: `1px solid ${theme.border}`,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 2px 12px rgba(13, 61, 59, 0.05)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: theme.muted,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 12,
          }}
        >
          Revenue &amp; bookings
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flex: 1, paddingBottom: 8 }}>
          {[38, 52, 45, 68, 58, 82, 71, 90, 76].map((h, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                borderRadius: 5,
                height: `${h}%`,
                minHeight: 28,
                maxHeight: 120,
                background: `linear-gradient(180deg, ${theme.teal}, ${theme.petrol})`,
                opacity: 0.88,
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 12, color: theme.muted, paddingTop: 8, borderTop: `1px solid ${theme.border}` }}>
          500+ companies · Lease &amp; hourly pipeline
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: theme.muted, textAlign: "center" }}>{hint}</p>
    </div>
  );
}

export function Cms2SiteChrome({
  org,
  basePath,
  locale,
  ui,
  children,
}: {
  org: PublicOrgPayload;
  basePath: string;
  locale: CmsMarketingLocale;
  ui: CmsPublicUi;
  children: ReactNode;
}) {
  const t = themeFromBrand(org.primaryColor, org.secondaryColor);
  const prefix = basePath || "";
  const nav = [
    { href: prefix ? `${prefix}/` : "/", label: tx(ui, "nav.home") },
    { href: `${prefix}/spaces`, label: tx(ui, "nav.spaces") },
    { href: `${prefix}/book`, label: tx(ui, "nav.book") },
    { href: `${prefix}/contact`, label: tx(ui, "nav.contact") },
    { href: `${prefix}/portal`, label: tx(ui, "nav.portal") },
  ];

  return (
    <div
      className={`${dmSans.className} cms2-public-shell`}
      style={{
        minHeight: "100vh",
        background: t.bg,
        color: t.text,
        overflowX: "hidden",
        maxWidth: "100vw",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ height: 4, background: `linear-gradient(90deg, ${t.petrol}, ${t.teal})` }} />
      <Cms2HeaderClient org={org} theme={t} nav={nav} basePath={prefix} locale={locale} ui={ui} />
      {children}
      <footer
        style={{
          background: t.petrolDark,
          color: "#b8d4d2",
          padding: "48px 22px max(40px, env(safe-area-inset-bottom, 0px))",
          marginTop: 48,
          overflowX: "hidden",
          maxWidth: "100vw",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            maxWidth: 1120,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 32,
            fontSize: 14,
          }}
        >
          <div>
            <strong style={{ color: "#fff", display: "block", marginBottom: 12 }}>{tx(ui, "footer.contact")}</strong>
            {org.settings.contactEmail ? (
              <div style={{ marginBottom: 8 }}>
                <span style={{ display: "block", fontSize: 12, opacity: 0.85, marginBottom: 2 }}>Email</span>
                <a href={`mailto:${org.settings.contactEmail}`} style={footerLinkStyle}>
                  {org.settings.contactEmail}
                </a>
              </div>
            ) : null}
            {org.settings.contactSalesEmail ? (
              <div style={{ marginBottom: 8 }}>
                <span style={{ display: "block", fontSize: 12, opacity: 0.85, marginBottom: 2 }}>{tx(ui, "footer.sales")}</span>
                <a href={`mailto:${org.settings.contactSalesEmail}`} style={footerLinkStyle}>
                  {org.settings.contactSalesEmail}
                </a>
              </div>
            ) : null}
            {org.settings.contactPhone ? (
              <div>
                <span style={{ display: "block", fontSize: 12, opacity: 0.85, marginBottom: 2 }}>{tx(ui, "footer.phone")}</span>
                <a href={phoneTelHref(org.settings.contactPhone)} style={footerLinkStyle}>
                  {org.settings.contactPhone}
                </a>
              </div>
            ) : null}
            {!org.settings.contactEmail && !org.settings.contactSalesEmail && !org.settings.contactPhone ? (
              <span>—</span>
            ) : null}
          </div>
          <div>
            <strong style={{ color: "#fff", display: "block", marginBottom: 12 }}>{tx(ui, "footer.explore")}</strong>
            {footerExploreLinks(prefix, ui).map((item) => (
              <Link key={item.label + item.href} href={item.href} style={footerLinkStyle}>
                {item.label}
              </Link>
            ))}
          </div>
          <div>
            <strong style={{ color: "#fff", display: "block", marginBottom: 12 }}>{tx(ui, "footer.company")}</strong>
            {(org.settings.footerCompanyLinks ?? []).map((item) => (
              <a key={item.label + item.href} href={item.href} style={footerLinkStyle} rel="noopener noreferrer">
                {item.label}
              </a>
            ))}
          </div>
          <div>
            <strong style={{ color: "#fff", display: "block", marginBottom: 12 }}>{tx(ui, "footer.social")}</strong>
            {(org.settings.footerSocialLinks ?? []).map((item) => (
              <a key={item.label + item.href} href={item.href} style={footerLinkStyle} rel="noopener noreferrer">
                {item.label}
              </a>
            ))}
          </div>
          <div>
            <strong style={{ color: "#fff", display: "block", marginBottom: 8 }}>{org.brandName}</strong>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function Cms2Hero({
  org,
  theme,
  defaultHeroImageUrl,
  basePath,
  ui,
}: {
  org: PublicOrgPayload;
  theme: ReturnType<typeof themeFromBrand>;
  defaultHeroImageUrl?: string | null;
  basePath: string;
  ui: CmsPublicUi;
}) {
  const cmsHero = org.settings.heroImageUrl?.trim();
  const fallback = defaultHeroImageUrl?.trim() || null;
  const heroUrl = cmsHero || fallback;
  const heroAlt = cmsHero
    ? `${org.brandName} — featured image`
    : fallback
      ? "Office space at Erottaja2, Erottajankatu, Helsinki"
      : "";

  const eyebrow = org.settings.heroEyebrow?.trim();
  const statsLine = org.settings.heroStatsLine?.trim();
  const { main: headMain, accent: headAccent } = splitHeadline(org.settings.headline);
  const p = basePath;

  return (
    <section
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: "40px 22px 48px",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.12fr) minmax(0, 1fr)",
        gap: 44,
        alignItems: "center",
        width: "100%",
        boxSizing: "border-box",
        overflowX: "hidden",
      }}
      className="cms2-hero-grid"
    >
      <div style={{ minWidth: 0, maxWidth: "100%" }}>
        {eyebrow ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              marginBottom: 18,
              padding: "7px 16px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: "0.01em",
              color: theme.petrolDark,
              background: "rgba(26, 92, 90, 0.07)",
              border: `1px solid rgba(226, 236, 236, 0.95)`,
            }}
          >
            {eyebrow}
          </div>
        ) : null}
        <h1
          className={`${instrumentSerif.className} cms2-hero-headline`}
          style={{
            margin: "0 0 18px",
            fontSize: "clamp(32px, 8vw, 68px)",
            fontWeight: 400,
            letterSpacing: "-0.02em",
            lineHeight: 1.12,
            color: theme.petrolDark,
            wordBreak: "break-word",
            overflowWrap: "anywhere",
          }}
        >
          {headMain}
          {headAccent ? (
            <>
              {" "}
              <span style={{ fontStyle: "italic", color: theme.teal }}>{headAccent}</span>
            </>
          ) : null}
        </h1>
        <p
          className="cms2-hero-sub"
          style={{ margin: "0 0 26px", fontSize: "1.09rem", color: theme.muted, maxWidth: 540, lineHeight: 1.6 }}
        >
          {org.settings.subheadline}
        </p>
        <div className="cms2-hero-ctas" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Link
            href={`${p}/spaces`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 44,
              padding: "11px 20px",
              borderRadius: 10,
              fontWeight: 600,
              fontSize: "0.94rem",
              background: theme.petrol,
              color: "#fff",
              textDecoration: "none",
              boxShadow: "0 4px 14px rgba(26, 92, 90, 0.35)",
            }}
          >
            {tx(ui, "hero.browseSpaces")}
          </Link>
          <Link
            href={`${p}/contact`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 44,
              padding: "11px 20px",
              borderRadius: 10,
              fontWeight: 600,
              fontSize: "0.94rem",
              background: theme.surface,
              color: theme.petrol,
              border: `1px solid ${theme.border}`,
              textDecoration: "none",
            }}
          >
            {tx(ui, "hero.enquire")}
          </Link>
        </div>
        {statsLine ? (
          <p
            className="cms2-hero-stats-line"
            style={{
              margin: "22px 0 0",
              fontSize: "0.92rem",
              fontWeight: 500,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: theme.muted,
            }}
          >
            {statsLine}
          </p>
        ) : null}
      </div>

      <div
        className={heroUrl ? "cms2-hero-aside-photo" : "cms2-hero-aside"}
        style={{
          borderRadius: 16,
          background: theme.surface,
          boxShadow: "0 16px 48px rgba(13, 61, 59, 0.1)",
          border: `1px solid ${theme.border}`,
          overflow: "hidden",
          minHeight: heroUrl ? 400 : 400,
        }}
      >
        {heroUrl ? (
          <div
            className="cms2-hero-photo"
            style={{ position: "relative", height: 400, background: `linear-gradient(160deg, ${theme.accentBg}, #d4efec)` }}
          >
            <Image
              src={heroUrl}
              alt={heroAlt}
              fill
              style={{ objectFit: "cover", objectPosition: "center" }}
              sizes="(max-width:900px) 100vw, 520px"
              unoptimized
              priority
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                padding: "20px 18px 16px",
                background: "linear-gradient(180deg, transparent 0%, rgba(13, 61, 59, 0.75) 100%)",
                color: "#f4faf9",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              {cmsHero ? <>{tx(ui, "hero.captionCms")}</> : <>{tx(ui, "hero.captionPhoto")}</>}
            </div>
          </div>
        ) : (
          <Cms2HeroDashboardPreview theme={theme} hint={tx(ui, "hero.dashboardHint")} />
        )}
      </div>

      <style>{`
        @media (max-width: 767px) {
          .cms2-hero-grid {
            grid-template-columns: 1fr !important;
            padding: 100px 20px 60px !important;
            gap: 24px !important;
          }
          .cms2-hero-headline {
            font-size: 36px !important;
            line-height: 1.15 !important;
          }
          .cms2-hero-sub {
            max-width: 100% !important;
          }
          .cms2-hero-ctas {
            flex-direction: column !important;
            align-items: stretch !important;
          }
          .cms2-hero-ctas a {
            width: 100% !important;
            box-sizing: border-box !important;
          }
          .cms2-hero-stats-line {
            display: block !important;
            overflow-x: auto !important;
            -webkit-overflow-scrolling: touch !important;
            white-space: nowrap !important;
            padding-bottom: 4px !important;
            margin-top: 18px !important;
          }
          .cms2-hero-photo { display: none !important; }
          .cms2-hero-aside-photo { display: none !important; }
        }
      `}</style>
    </section>
  );
}
