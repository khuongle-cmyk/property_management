"use client";

import type { JSX } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMarketingTenant } from "@/contexts/MarketingTenantContext";

type TabDef = {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
  Icon: () => JSX.Element;
};

function IconDashboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path
        d="M4 13h6V4H4v9zm0 7h6v-5H4v5zm8 0h8v-9h-8v9zm0-16v5h8V4h-8z"
        fill="currentColor"
        opacity="0.92"
      />
    </svg>
  );
}

function IconCampaigns() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path
        d="M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zm6 6a3 3 0 100-6 3 3 0 000 6z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path d="M8.59 13.51l6.82 3.98M15.41 6.51L8.59 10.49" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconEmail() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path
        d="M4 6h16v12H4V6zm0 0l8 6 8-6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSms() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path
        d="M4 5h16v10H8l-4 4V5z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSocial() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="17" cy="9" r="2.25" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M4 19c0-2.5 2-4.5 5-4.5.8 0 1.6.15 2.3.4M14.8 14.2c2.1.6 3.7 2.3 4.2 4.3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconEvents() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconOffers() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path
        d="M4 10V8a2 2 0 012-2h12a2 2 0 012 2v2M4 10h16v9a1 1 0 01-1 1H5a1 1 0 01-1-1v-9zM9 10V7m6 3V7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconReferrals() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.75" />
      <path d="M4 19c0-2.2 2.2-4 5-4 .7 0 1.3.1 1.9.25" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.25" stroke="currentColor" strokeWidth="1.75" />
      <path d="M17 14v5M14.5 16.5L17 14l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconAnalytics() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path d="M5 19V11M12 19V5M19 19v-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M4 19h16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

const TABS: TabDef[] = [
  {
    href: "/marketing",
    label: "Dashboard",
    isActive: (pathname) => {
      const p = stripTrailingSlash(pathname);
      return p === "/marketing";
    },
    Icon: IconDashboard,
  },
  {
    href: "/marketing/campaigns",
    label: "Campaigns",
    isActive: (pathname) => pathname.startsWith("/marketing/campaigns"),
    Icon: IconCampaigns,
  },
  {
    href: "/marketing/email",
    label: "Email",
    isActive: (pathname) => pathname.startsWith("/marketing/email"),
    Icon: IconEmail,
  },
  {
    href: "/marketing/sms",
    label: "SMS",
    isActive: (pathname) => pathname.startsWith("/marketing/sms"),
    Icon: IconSms,
  },
  {
    href: "/marketing/social",
    label: "Social",
    isActive: (pathname) => pathname.startsWith("/marketing/social"),
    Icon: IconSocial,
  },
  {
    href: "/marketing/events",
    label: "Events",
    isActive: (pathname) => pathname.startsWith("/marketing/events"),
    Icon: IconEvents,
  },
  {
    href: "/marketing/offers",
    label: "Offers",
    isActive: (pathname) => pathname.startsWith("/marketing/offers"),
    Icon: IconOffers,
  },
  {
    href: "/marketing/referrals",
    label: "Referrals",
    isActive: (pathname) => pathname.startsWith("/marketing/referrals"),
    Icon: IconReferrals,
  },
  {
    href: "/marketing/analytics",
    label: "Analytics",
    isActive: (pathname) => pathname.startsWith("/marketing/analytics"),
    Icon: IconAnalytics,
  },
];

export default function MarketingNav() {
  const pathname = usePathname() ?? "";
  const { querySuffix } = useMarketingTenant();

  return (
    <nav className="mb-6 flex flex-wrap gap-2 border-b border-gray-200 pb-4" aria-label="Marketing sections">
      {TABS.map(({ href, label, isActive, Icon }) => {
        const active = isActive(pathname);
        const to = `${href}${querySuffix}`;
        return (
          <Link
            key={href}
            href={to}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-[#1a5c50] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
            aria-current={active ? "page" : undefined}
          >
            <Icon />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
