"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";

const links: {
  href: string;
  label: string;
  setupHref?: string;
  setupHint?: string;
}[] = [
  { href: "/marketing", label: "📊 Dashboard" },
  { href: "/marketing/campaigns", label: "📋 Campaigns" },
  { href: "/marketing/email", label: "📧 Email" },
  { href: "/marketing/sms", label: "💬 SMS", setupHref: "/settings#integrations", setupHint: "Twilio" },
  { href: "/marketing/social", label: "📱 Social", setupHref: "/settings#integrations", setupHint: "OAuth connections" },
  { href: "/marketing/events", label: "🎉 Events" },
  { href: "/marketing/offers", label: "🏷️ Offers" },
  { href: "/marketing/referrals", label: "👥 Referrals" },
  { href: "/marketing/analytics", label: "📈 Analytics", setupHref: "/settings#integrations", setupHint: "Google Ads API key" },
];

export default function MarketingSubNav() {
  const pathname = usePathname();
  const { querySuffix } = useMarketingTenant();

  return (
    <nav
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginBottom: 20,
        paddingBottom: 16,
        borderBottom: "1px solid rgba(26,74,74,0.12)",
      }}
    >
      {links.map(({ href, label, setupHref, setupHint }) => {
        const hrefWithQuery = `${href}${querySuffix}`;
        const active = pathname === href || (href !== "/marketing" && pathname?.startsWith(href + "/"));
        return (
          <div
            key={href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 13,
              background: active ? "var(--petrol, #1a4a4a)" : "rgba(26,74,74,0.06)",
            }}
          >
            <Link
              href={hrefWithQuery}
              style={{
                textDecoration: "none",
                color: active ? "#fff" : "var(--petrol, #1a4a4a)",
                fontWeight: active ? 600 : 400,
              }}
            >
              {label}
            </Link>
            {setupHref ? (
              <Link
                href={setupHref}
                title={setupHint ? `Add ${setupHint} in Settings` : "Configure in Settings"}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: active ? "rgba(255,255,255,0.2)" : "rgba(180, 35, 24, 0.12)",
                  color: active ? "#fff" : "#8a2c0d",
                  textDecoration: "none",
                }}
              >
                Setup required
              </Link>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
