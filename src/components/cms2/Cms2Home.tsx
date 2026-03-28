import Link from "next/link";
import type { CmsMarketingLocale } from "@/lib/cms2/marketing-locales";
import type { PublicOrgPayload } from "@/lib/cms2/types";
import { themeFromBrand } from "@/lib/cms2/types";
import type { CmsPublicUi } from "@/lib/cms2/public-ui";
import { resolveCmsPublicUi, tx } from "@/lib/cms2/public-ui";
import { publicSpaceUrlSegment } from "@/lib/cms2/slug";
import { Cms2PublicSpacesFetchClient } from "./Cms2PublicSpacesFetchClient";
import { Cms2Hero, Cms2SiteChrome, DEFAULT_CMS2_HERO_IMAGE_URL } from "./Cms2SiteChrome";

function spaceTypeLabel(ui: CmsPublicUi, st: string): string {
  const k = `spaceType.${st}` as const;
  const v = tx(ui, k);
  return v === k ? st.replace(/_/g, " ") : v;
}

export function Cms2Home({
  org,
  basePath,
  locale,
  ui: uiProp,
  /** When true (root `/` or `/[orgSlug]`), spaces load in the browser via `fetch('/api/spaces/public')`. */
  publicBrowse = false,
}: {
  org: PublicOrgPayload;
  basePath: string;
  locale: CmsMarketingLocale;
  /** Optional: when omitted or null, strings load from `messages/cms-public` via locale (not from DB / page_content). */
  ui?: CmsPublicUi | null;
  publicBrowse?: boolean;
}) {
  const ui = resolveCmsPublicUi(uiProp, locale);
  const t = themeFromBrand(org.primaryColor, org.secondaryColor);
  const p = basePath;

  const useApiList = publicBrowse;
  const listFromOrg = org.spaces;

  return (
    <Cms2SiteChrome org={org} basePath={basePath} locale={locale} ui={ui}>
      <Cms2Hero
        org={org}
        theme={t}
        basePath={basePath}
        ui={ui}
        defaultHeroImageUrl={basePath === "" ? DEFAULT_CMS2_HERO_IMAGE_URL : null}
      />
      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "12px 22px 56px" }}>
        {useApiList ? (
          <Cms2PublicSpacesFetchClient theme={t} basePath={p} locale={locale} ui={ui} variant="home" />
        ) : (
          <>
            <h2 style={{ margin: "0 0 8px", fontSize: "1.35rem", color: t.petrolDark }}>{tx(ui, "home.availableSpaces")}</h2>
            <p style={{ margin: "0 0 28px", color: t.muted, fontSize: "0.95rem" }}>{tx(ui, "home.availableSpacesDesc")}</p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 18,
              }}
            >
              {listFromOrg.slice(0, 9).map((s) => (
                <article
                  key={s.id}
                  style={{
                    background: t.surface,
                    borderRadius: 14,
                    border: `1px solid ${t.border}`,
                    padding: 20,
                    boxShadow: "0 4px 20px rgba(13, 61, 59, 0.04)",
                  }}
                >
                  <h3 style={{ margin: "0 0 8px", fontSize: "1.05rem", color: t.petrol }}>{s.name}</h3>
                  <p style={{ margin: 0, fontSize: "0.9rem", color: t.muted }}>
                    {spaceTypeLabel(ui, s.spaceType)} · {s.propertyName}
                  </p>
                  {org.settings.showPrices ? (
                    <div style={{ marginTop: 12, fontWeight: 700, color: t.petrolDark, fontSize: "0.95rem" }}>
                      {tx(ui, "home.perHour").replace("__PRICE__", Number(s.hourlyPrice).toFixed(0))}
                    </div>
                  ) : (
                    <div style={{ marginTop: 12, fontWeight: 600, color: t.muted, fontSize: "0.95rem" }}>{tx(ui, "home.priceOnRequest")}</div>
                  )}
                  <div style={{ marginTop: 14 }}>
                    <Link
                      href={`${p}/spaces/${publicSpaceUrlSegment(s)}`}
                      style={{ color: t.teal, fontWeight: 600, fontSize: 14, textDecoration: "none" }}
                    >
                      {tx(ui, "home.viewBook")}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
            {org.spaces.length === 0 ? <p style={{ color: t.muted }}>{tx(ui, "home.noSpaces")}</p> : null}
          </>
        )}
      </section>
      {org.settings.testimonials.length ? (
        <section style={{ maxWidth: 1120, margin: "0 auto", padding: "0 22px 48px" }}>
          <h2 style={{ fontSize: "1.35rem", color: t.petrolDark }}>{tx(ui, "home.whatTenantsSay")}</h2>
          <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
            {org.settings.testimonials.map((x, i) => (
              <blockquote
                key={i}
                style={{
                  margin: 0,
                  padding: 20,
                  background: t.surface,
                  borderRadius: 14,
                  border: `1px solid ${t.border}`,
                  fontSize: "0.95rem",
                  color: t.text,
                }}
              >
                <p style={{ margin: "0 0 8px" }}>&ldquo;{x.quote}&rdquo;</p>
                <footer style={{ color: t.muted, fontSize: 14 }}>
                  — {x.author}
                  {x.role ? `, ${x.role}` : ""}
                </footer>
              </blockquote>
            ))}
          </div>
        </section>
      ) : null}
    </Cms2SiteChrome>
  );
}
