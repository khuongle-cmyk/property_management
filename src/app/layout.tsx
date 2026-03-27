import type { Metadata } from "next";
import type { ReactNode } from "react";
import AppNav from "@/components/AppNav";
import BrandProvider from "@/components/BrandProvider";
import LeadChatbotWidget from "@/components/LeadChatbotWidget";
import VoiceAssistantWidget from "@/components/VoiceAssistantWidget";
import { DEFAULT_BRAND } from "@/lib/brand/default";

export const metadata: Metadata = {
  title: "Workspace Platform",
  description: "White-label workspace management platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        style={{
          fontFamily: DEFAULT_BRAND.font_family ?? undefined,
          margin: 0,
          background: "var(--brand-background)",
          color: "var(--brand-text)",
        }}
      >
        <BrandProvider>
          <div style={{ minHeight: "100vh", display: "flex" }}>
            <AppNav />
            <main className="vw-main-shell" style={{ flex: 1, minWidth: 0, padding: "72px 16px 24px 16px" }}>
              {children}
            </main>
          </div>
          <style>{`
            :root {
              --brand-primary: ${DEFAULT_BRAND.primary_color};
              --brand-secondary: ${DEFAULT_BRAND.secondary_color};
              --brand-sidebar: ${DEFAULT_BRAND.sidebar_color};
              --brand-background: ${DEFAULT_BRAND.background_color};
              --brand-text: ${DEFAULT_BRAND.text_color};
              --brand-accent: ${DEFAULT_BRAND.accent_color};
              --brand-logo: "${DEFAULT_BRAND.logo_url ?? ""}";
            }
            @media (min-width: 961px) {
              .vw-main-shell {
                padding: 24px 24px 28px 24px !important;
              }
            }
          `}</style>
          <LeadChatbotWidget />
          <VoiceAssistantWidget />
        </BrandProvider>
      </body>
    </html>
  );
}

