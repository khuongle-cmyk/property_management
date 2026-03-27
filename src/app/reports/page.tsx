"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { REPORT_READER_ROLES } from "@/lib/reports/report-access";

export default function ReportsHubPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let c = false;
    (async () => {
      const supabase = getSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (c) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: mem } = await supabase.from("memberships").select("role");
      const roles = (mem ?? []).map((m: { role: string | null }) => (m.role ?? "").toLowerCase());
      if (!roles.some((r: string) => REPORT_READER_ROLES.has(r))) {
        setForbidden(true);
      }
      setReady(true);
    })();
    return () => {
      c = true;
    };
  }, [router]);

  if (!ready) return <p style={{ color: "#666" }}>Loading…</p>;
  if (forbidden) {
    return (
      <main>
        <p style={{ color: "#b00020" }}>You don&apos;t have access to financial reports.</p>
        <Link href="/">Home</Link>
      </main>
    );
  }

  return (
    <main>
      <h1 style={{ margin: "0 0 12px" }}>Financial reports</h1>
      <p style={{ margin: "0 0 20px", color: "#555", maxWidth: 560 }}>
        Choose a report type. Revenue uses the same sources as the rent roll (leases, bookings, and add-on services). Net
        income subtracts operating costs you record per property.
      </p>
      <ul style={{ lineHeight: 1.9, paddingLeft: 18 }}>
        <li>
          <Link href="/reports/rent-roll">Rent roll &amp; revenue forecast</Link>
        </li>
        <li>
          <Link href="/reports/net-income">Net income report</Link> — revenue minus operating costs, margin % per
          property and month
        </li>
      </ul>
      <p style={{ marginTop: 24, fontSize: 14, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Link href="/dashboard">Owner dashboard</Link>
        <Link href="/super-admin">Super admin</Link>
      </p>
    </main>
  );
}
