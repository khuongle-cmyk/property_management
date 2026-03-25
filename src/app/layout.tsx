import type { Metadata } from "next";
import type { ReactNode } from "react";

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
        <div style={{ maxWidth: 900, margin: "0 auto" }}>{children}</div>
      </body>
    </html>
  );
}

