import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { DM_Sans, Instrument_Serif } from "next/font/google";
import BrandProvider from "@/components/BrandProvider";
import ConditionalWorkspaceChrome from "@/components/ConditionalWorkspaceChrome";
import { DEFAULT_BRAND } from "@/lib/brand/default";
import { getAppNavInitialState } from "@/lib/nav/get-app-nav-initial";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
  variable: "--font-dm-sans",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-instrument-serif",
});

export const metadata: Metadata = {
  title: "Workspace Platform",
  description: "White-label workspace management platform",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

/** Session-dependent nav must not be statically cached at build time. */
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const appNavInitial = await getAppNavInitialState();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=Instrument+Serif:ital@0;1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={`${dmSans.className} ${dmSans.variable} ${instrumentSerif.variable}`}
        style={{
          margin: 0,
          background: "var(--warm-white, #faf9f6)",
          color: "var(--brand-text)",
          fontFamily: "'DM Sans', sans-serif",
          overflowX: "hidden",
          maxWidth: "100vw",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <BrandProvider>
          <ConditionalWorkspaceChrome appNavInitial={appNavInitial}>{children}</ConditionalWorkspaceChrome>
          <style>{`
            html {
              background: var(--warm-white, #faf9f6);
              overflow-x: hidden;
              max-width: 100vw;
            }
            :root {
              --petrol: #1a4a4a;
              --petrol-mid: #1f5c5c;
              --cream: #f4f1ec;
              --warm-white: #faf9f6;
              --teal: #3aafa9;
              --brand-primary: ${DEFAULT_BRAND.primary_color};
              --brand-secondary: ${DEFAULT_BRAND.secondary_color};
              --brand-sidebar: ${DEFAULT_BRAND.sidebar_color};
              --brand-background: #faf9f6;
              --brand-text: ${DEFAULT_BRAND.text_color};
              --brand-accent: ${DEFAULT_BRAND.accent_color};
              --brand-logo: "${DEFAULT_BRAND.logo_url ?? ""}";
            }
          `}</style>
        </BrandProvider>
      </body>
    </html>
  );
}

