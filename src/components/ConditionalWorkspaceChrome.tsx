"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import AppNav from "@/components/AppNav";
import type { AppNavInitialState } from "@/lib/nav/nav-flags";
import LeadChatbotWidget from "@/components/LeadChatbotWidget";
import VoiceAssistantWidget from "@/components/VoiceAssistantWidget";
import { isReservedOrgSlug } from "@/lib/cms2/reserved-slugs";

function isPublicMarketingPath(pathname: string | null): boolean {
  if (pathname === "/") return true;
  // When pathname is not ready yet, treat as app shell (keeps sidebar visible on /super-admin etc.).
  if (!pathname) return false;
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return false;
  if (isReservedOrgSlug(seg)) return false;
  return true;
}

export default function ConditionalWorkspaceChrome({
  children,
  appNavInitial,
}: {
  children: ReactNode;
  appNavInitial: AppNavInitialState;
}) {
  const pathname = usePathname();
  const publicSite = isPublicMarketingPath(pathname);

  if (publicSite) {
    return (
      <>
        {children}
        <LeadChatbotWidget />
        <VoiceAssistantWidget />
      </>
    );
  }

  return (
    <>
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
          background: "#faf9f6",
        }}
      >
        <div
          className="vw-app-nav-column"
          style={{
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            alignSelf: "stretch",
            minHeight: "100vh",
          }}
        >
          <AppNav appNavInitial={appNavInitial} />
        </div>
        <main
          className="vw-main-shell"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "72px 16px 24px 16px",
            fontFamily: "var(--font-dm-sans), sans-serif",
            background: "#faf9f6",
            color: "var(--petrol, #1a4a4a)",
          }}
        >
          {children}
        </main>
      </div>
      <style>{`
        .vw-main-shell {
          color: var(--petrol, #1a4a4a);
          font-family: var(--font-dm-sans), sans-serif;
        }
        .vw-main-shell h1 {
          font-family: var(--font-instrument-serif), serif;
          font-weight: 400;
          letter-spacing: -0.02em;
        }
        .vw-main-shell h2,
        .vw-main-shell h3 {
          font-family: var(--font-dm-sans), sans-serif;
          font-weight: 500;
        }
        .vw-main-shell table {
          font-family: var(--font-dm-sans), sans-serif;
          font-size: 13px;
          font-weight: 400;
        }
        .vw-main-shell label {
          font-family: var(--font-dm-sans), sans-serif;
          font-size: 14px;
          font-weight: 500;
        }
        .vw-main-shell button,
        .vw-main-shell .vw-btn-primary,
        .vw-main-shell .vw-btn-secondary {
          font-family: var(--font-dm-sans), sans-serif;
          font-weight: 500;
          font-size: 14px;
        }
        .vw-card {
          font-family: var(--font-dm-sans), sans-serif;
          background: #fff;
          border-radius: 14px;
          border: 1px solid rgba(26, 74, 74, 0.1);
          box-shadow: 0 4px 22px rgba(26, 74, 74, 0.07);
        }
        .vw-btn-primary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 10px 18px;
          border-radius: 10px;
          border: none;
          font-weight: 500;
          font-size: 14px;
          cursor: pointer;
          background: var(--petrol, #1a4a4a);
          color: #fff;
          box-shadow: 0 2px 8px rgba(26, 74, 74, 0.2);
        }
        .vw-btn-primary:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .vw-btn-secondary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 10px 18px;
          border-radius: 10px;
          border: 1px solid rgba(58, 175, 169, 0.45);
          font-weight: 500;
          font-size: 14px;
          cursor: pointer;
          background: #fff;
          color: var(--teal, #3aafa9);
        }
        .vw-input {
          font-family: var(--font-dm-sans), sans-serif;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(26, 74, 74, 0.18);
          font-size: 14px;
          font-weight: 400;
          background: #fff;
          color: var(--petrol, #1a4a4a);
        }
        @media (min-width: 768px) {
          .vw-main-shell {
            padding: 24px 24px 28px 24px !important;
          }
        }
      `}</style>
      <LeadChatbotWidget />
      <VoiceAssistantWidget />
    </>
  );
}
