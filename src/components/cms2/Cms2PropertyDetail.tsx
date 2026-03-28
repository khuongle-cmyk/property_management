import Link from "next/link";
import type { CmsMarketingLocale } from "@/lib/cms2/marketing-locales";
import type { PublicOrgPayload } from "@/lib/cms2/types";
import type { CmsTheme } from "@/lib/cms2/types";
import type { CmsPublicUi } from "@/lib/cms2/public-ui";
import { tx } from "@/lib/cms2/public-ui";
import { publicSpaceUrlSegment } from "@/lib/cms2/slug";
import {
  activeAmenitiesForRow,
  type PublicPropertyGroup,
  type SpaceTypeBucket,
  spaceTypeToBucket,
  SPACE_TYPE_BUCKETS,
  publicPageQuery,
} from "@/lib/spaces/public-browse";
import type { PublicBookableSpaceApiRow } from "@/lib/spaces/public-spaces-shared";

function bucketTxKey(b: SpaceTypeBucket): string {
  return `propertyBucket.${b}`;
}

function spaceTypeLabel(ui: CmsPublicUi, st: string): string {
  const k = `spaceType.${st}`;
  const v = tx(ui, k);
  return v === k ? st.replace(/_/g, " ") : v;
}

export function Cms2PropertyDetail({
  org,
  theme,
  basePath,
  locale,
  ui,
  group,
  typeFilter,
}: {
  org: PublicOrgPayload;
  theme: CmsTheme;
  basePath: string;
  locale: CmsMarketingLocale;
  ui: CmsPublicUi;
  group: PublicPropertyGroup;
  typeFilter: SpaceTypeBucket | "all";
}) {
  const p = basePath;
  const lang = locale;

  const filtered: PublicBookableSpaceApiRow[] =
    typeFilter === "all"
      ? group.spaces
      : group.spaces.filter((s) => spaceTypeToBucket(s.space_type) === typeFilter);

  const tabs: { id: SpaceTypeBucket | "all"; label: string }[] = [
    { id: "all", label: tx(ui, "propertySpaces.all") },
    ...SPACE_TYPE_BUCKETS.map((b) => ({ id: b, label: tx(ui, bucketTxKey(b)) })),
  ];

  return (
    <>
      <section style={{ position: "relative", width: "100%", marginBottom: 8 }}>
        <div style={{ width: "100%", maxHeight: 320, overflow: "hidden", borderRadius: "0 0 18px 18px", background: theme.bg }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={group.cardImageUrl}
            alt=""
            style={{ width: "100%", height: 280, objectFit: "cover", display: "block" }}
          />
        </div>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "20px 22px 0" }}>
          <Link href={`${p}/spaces${publicPageQuery({ lang })}`} style={{ color: theme.teal, fontSize: 14, fontWeight: 600 }}>
            {tx(ui, "propertySpaces.backToLocations")}
          </Link>
          <h1 style={{ margin: "12px 0 8px", fontSize: "1.85rem", color: theme.petrolDark }}>{group.propertyName}</h1>
          {group.addressLine ? (
            <p style={{ margin: 0, fontSize: "1.05rem", color: theme.muted }}>{group.addressLine}</p>
          ) : null}
        </div>
      </section>

      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "12px 22px 48px" }}>
        <div
          role="tablist"
          aria-label={tx(ui, "propertySpaces.filterTabs")}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 24,
            borderBottom: `1px solid ${theme.border}`,
            paddingBottom: 12,
          }}
        >
          {tabs.map((tab) => {
            const active = tab.id === typeFilter;
            const href =
              tab.id === "all"
                ? `${p}/spaces/${encodeURIComponent(group.slug)}${publicPageQuery({ lang })}`
                : `${p}/spaces/${encodeURIComponent(group.slug)}${publicPageQuery({ lang, type: tab.id })}`;
            return (
              <Link
                key={tab.id}
                href={href}
                scroll={false}
                role="tab"
                aria-selected={active}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  fontWeight: 600,
                  fontSize: 14,
                  textDecoration: "none",
                  border: `1px solid ${active ? theme.petrol : theme.border}`,
                  background: active ? theme.accentBg : "transparent",
                  color: active ? theme.petrol : theme.text,
                }}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))",
            gap: 18,
          }}
        >
          {filtered.map((row) => {
            const bucket = spaceTypeToBucket(row.space_type);
            const showEnquire = bucket === "office" || bucket === "venue";
            const amenities = activeAmenitiesForRow(row);
            const m2 = row.size_m2 != null && Number.isFinite(Number(row.size_m2)) ? Number(row.size_m2) : null;
            return (
              <article
                key={row.id}
                style={{
                  background: theme.surface,
                  borderRadius: 14,
                  border: `1px solid ${theme.border}`,
                  padding: 18,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  boxShadow: "0 4px 18px rgba(13, 61, 59, 0.05)",
                }}
              >
                <h2 style={{ margin: 0, fontSize: "1.08rem", color: theme.petrol }}>{row.name}</h2>
                <p style={{ margin: 0, fontSize: 13, color: theme.muted }}>
                  {spaceTypeLabel(ui, row.space_type)}
                </p>
                <p style={{ margin: 0, fontSize: 14, color: theme.text }}>
                  {m2 != null
                    ? tx(ui, "propertySpaces.sizeLine")
                        .replace("__M2__", String(m2))
                        .replace("__N__", String(row.capacity ?? "—"))
                    : tx(ui, "spaces.people").replace("__N__", String(row.capacity ?? "—"))}
                </p>
                {org.settings.showPrices ? (
                  <p style={{ margin: 0, fontWeight: 700, color: theme.petrolDark }}>
                    {tx(ui, "spaces.perHour").replace("__PRICE__", Number(row.hourly_price ?? 0).toFixed(0))}
                  </p>
                ) : (
                  <p style={{ margin: 0, fontWeight: 600, color: theme.muted }}>{tx(ui, "home.priceOnRequest")}</p>
                )}
                {amenities.length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }} aria-label={tx(ui, "propertySpaces.amenities")}>
                    {amenities.slice(0, 8).map((a) => (
                      <span key={a.key} title={a.label} style={{ fontSize: 18, lineHeight: 1 }}>
                        {a.icon}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div style={{ marginTop: "auto", display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <Link
                    href={`${p}/spaces/${publicSpaceUrlSegment({ id: row.id, name: row.name })}${publicPageQuery({ lang })}`}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 10,
                      background: theme.petrol,
                      color: "#fff",
                      fontWeight: 600,
                      fontSize: 14,
                      textDecoration: "none",
                    }}
                  >
                    {tx(ui, "spaces.bookNow")}
                  </Link>
                  {showEnquire ? (
                    <Link
                      href={`${p}/contact${publicPageQuery({ lang })}`}
                      style={{
                        padding: "10px 16px",
                        borderRadius: 10,
                        border: `1px solid ${theme.border}`,
                        color: theme.teal,
                        fontWeight: 600,
                        fontSize: 14,
                        textDecoration: "none",
                        background: theme.surface,
                      }}
                    >
                      {tx(ui, "spaces.enquire")}
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <p style={{ color: theme.muted, marginTop: 16 }}>{tx(ui, "propertySpaces.noneForFilter")}</p>
        ) : null}
      </section>
    </>
  );
}
