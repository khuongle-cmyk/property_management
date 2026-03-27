import type { Metadata } from "next";
import type { ReactNode } from "react";
import AppNav from "@/components/AppNav";
import LeadChatbotWidget from "@/components/LeadChatbotWidget";

export const metadata: Metadata = {
  title: "Property Management",
  description: "Simple property management system",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", Arial, sans-serif',
          margin: 0,
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <AppNav />
          {children}
        </div>
        <LeadChatbotWidget />
      </body>
    </html>
  );
}

