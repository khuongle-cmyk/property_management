import type { ReactNode } from "react";

/** Shared content shell for workspace pages (matches /dashboard spacing). */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <div style={{ display: "grid", gap: 14 }}>{children}</div>;
}
