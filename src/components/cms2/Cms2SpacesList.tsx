import Link from "next/link";
import type { CmsMarketingLocale } from "@/lib/cms2/marketing-locales";
import type { PublicOrgPayload } from "@/lib/cms2/types";
import { themeFromBrand } from "@/lib/cms2/types";
import type { CmsPublicUi } from "@/lib/cms2/public-ui";
import { tx } from "@/lib/cms2/public-ui";
import { publicSpaceUrlSegment } from "@/lib/cms2/slug";
import { Cms2PublicSpacesFetchClient } from "./Cms2PublicSpacesFetchClient";
import { Cms2SiteChrome } from "./Cms2SiteChrome";

function spaceTypeLabel(ui: CmsPublicUi, st: string): string {
  const k = `spaceType.${st}`;
  const v = tx(ui, k);
  return v === k ? st.replace(/_/g, " ") : v;
}

export function Cms2SpacesList({
  org,
  basePath,
  locale,
  ui,
  publicBrowse = false,
}: {
  org: PublicOrgPayload;
  basePath: string;
  locale: CmsMarketingLocale;
  ui: CmsPublicUi;
  /** When true, browse-by-property UI loads via `fetch('/api/spaces/public')` on the client. */
  publicBrowse?: boolean;
}) {
  const t = themeFromBrand(org.primaryColor, org.secondaryColor);
  const p = basePath;
  const useApi = publicBrowse;

  return (
    <Cms2SiteChrome org={org} basePath={basePath} locale={locale} ui={ui}>
      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "36px 22px 56px" }}>
        {useApi ? (
          <Cms2PublicSpacesFetchClient theme={t} basePath={p} locale={locale} ui={ui} variant="spaces" />
        ) : (
          <>
            <h1 style={{ margin: "0 0 8px", fontSize: "1.75rem", color: t.petrolDark }}>{tx(ui, "spaces.title")}</h1>
            <p style={{ margin: "0 0 28px", color: t.muted }}>{tx(ui, "spaces.lead")}</p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 20,
              }}
            >
              {org.spaces.map((s) => (
                <article
                  key={s.id}
                  style={{
                    background: t.surface,
                    borderRadius: 14,
                    border: `1px solid ${t.border}`,
                    padding: 22,
                    boxShadow: "0 4px 20px rgba(13, 61, 59, 0.05)",
                  }}
                >
                  <h2 style={{ margin: "0 0 8px", fontSize: "1.1rem", color: t.petrol }}>{s.name}</h2>
                  <p style={{ margin: 0, fontSize: 14, color: t.muted }}>
                    {spaceTypeLabel(ui, s.spaceType)} · {tx(ui, "spaces.people").replace("__N__", String(s.capacity))} · {s.propertyName}
                  </p>
                  {org.settings.showPrices ? (
                    <p style={{ margin: "14px 0 0", fontWeight: 700, color: t.petrolDark }}>
                      {tx(ui, "spaces.perHour").replace("__PRICE__", Number(s.hourlyPrice).toFixed(0))}
                    </p>
                  ) : (
                    <p style={{ margin: "14px 0 0", fontWeight: 600, color: t.muted }}>{tx(ui, "home.priceOnRequest")}</p>
                  )}
                  <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <Link
                      href={`${p}/spaces/${publicSpaceUrlSegment(s)}`}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 10,
                        background: t.petrol,
                        color: "#fff",
                        fontWeight: 600,
                        fontSize: 14,
                        textDecoration: "none",
                      }}
                    >
                      {tx(ui, "spaces.bookNow")}
                    </Link>
                    {(s.spaceType === "office" || s.spaceType === "venue") && (
                      <Link href={`${p}/contact`} style={{ padding: "8px 14px", color: t.teal, fontWeight: 600, fontSize: 14 }}>
                        {tx(ui, "spaces.enquire")}
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {org.spaces.length === 0 ? <p style={{ color: t.muted }}>{tx(ui, "spaces.noSpaces")}</p> : null}
          </>
        )}
      </section>
    </Cms2SiteChrome>
  );
}
