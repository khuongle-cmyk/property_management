"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/browser";

export default function Page() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!cancelled && user) {
        const { data: memberships, error: membershipsError } = await supabase
          .from("memberships")
          .select("role");

        if (membershipsError) {
          if (!cancelled) {
            setChecking(false);
          }
          return;
        }

        const membershipRows = (memberships ?? []) as Array<{ role: string | null }>;
        const isSuperAdmin = membershipRows.some(
          (m) => (m.role ?? "").toLowerCase() === "super_admin"
        );

        router.push(isSuperAdmin ? "/super-admin" : "/dashboard");
        return;
      }

      if (!cancelled) setChecking(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 12px" }}>Property Management</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        {checking ? "Checking session..." : "Sign in to view properties for your owner account."}
      </p>
      <button
        type="button"
        onClick={() => router.push("/login")}
        style={{
          display: "inline-block",
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #ddd",
          background: "#111",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        Sign in
      </button>
    </main>
  );
}

