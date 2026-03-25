"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/browser";
import LogoutButton from "./LogoutButton";

type PropertyRow = {
  tenant_id: string | null;
  name: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  total_units: number | null;
  occupied_units: number | null;
  status: string | null;
};

type MembershipRow = {
  tenant_id: string | null;
  role: string;
};

export default function DashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PropertyRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        if (!cancelled) setError(userError.message);
        if (!cancelled) setLoading(false);
        return;
      }

      if (!user) {
        router.push("/login");
        return;
      }

      const { data: memberships, error: membershipsError } = await supabase
        .from("memberships")
        .select("tenant_id,role");

      if (membershipsError) {
        if (!cancelled) setError(membershipsError.message);
        if (!cancelled) setLoading(false);
        return;
      }

      const membershipRows = (memberships ?? []) as MembershipRow[];
      const isSuperAdmin = membershipRows.some((m) => (m.role ?? "").toLowerCase() === "super_admin");
      const ownerTenantIds = membershipRows
        .filter((m) => (m.role ?? "").toLowerCase() === "owner")
        .map((m) => m.tenant_id)
        .filter(Boolean) as string[];

      if (isSuperAdmin) {
        router.replace("/super-admin");
        return;
      }

      if (!isSuperAdmin && ownerTenantIds.length === 0) {
        if (!cancelled) {
          setError("Not authorized to view the owner dashboard.");
          setRows([]);
          setLoading(false);
        }
        return;
      }

      let propertiesQuery = supabase
        .from("properties")
        .select(
          "tenant_id,name,address,postal_code,city,total_units,occupied_units,status"
        );

      if (!isSuperAdmin) {
        propertiesQuery = propertiesQuery.in("tenant_id", ownerTenantIds);
      }

      const { data: properties, error: propertiesError } = await propertiesQuery.order("name", {
        ascending: true,
      });

      if (propertiesError) {
        if (!cancelled) setError(propertiesError.message);
        if (!cancelled) setLoading(false);
        return;
      }

      if (!cancelled) setRows((properties as PropertyRow[]) ?? []);
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const summary = useMemo(() => {
    const totalUnits = rows.reduce((sum, p) => sum + (p.total_units ?? 0), 0);
    const occupiedUnits = rows.reduce((sum, p) => sum + (p.occupied_units ?? 0), 0);
    const occupancyPct =
      totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

    return { totalUnits, occupiedUnits, occupancyPct };
  }, [rows]);

  return (
    <main>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: "0 0 8px" }}>Dashboard</h1>
          <p style={{ margin: 0, color: "#555" }}>
            Occupancy across your subscribed properties.
          </p>
        </div>
        <LogoutButton />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 18 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
          <div style={{ color: "#666", fontSize: 12 }}>Properties</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            {loading ? "..." : rows.length}
          </div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
          <div style={{ color: "#666", fontSize: 12 }}>Units (total)</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            {loading ? "..." : summary.totalUnits}
          </div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
          <div style={{ color: "#666", fontSize: 12 }}>Occupied</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            {loading ? "..." : summary.occupiedUnits}
          </div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
          <div style={{ color: "#666", fontSize: 12 }}>Occupancy</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>
            {loading ? "..." : summary.occupancyPct}%
          </div>
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        {error ? (
          <p style={{ color: "#b00020" }}>Failed to load: {error}</p>
        ) : loading ? (
          <p>Loading...</p>
        ) : rows.length === 0 ? (
          <p>
            This account isn&apos;t connected to any owner tenant (or they have
            no properties yet).
          </p>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              border: "1px solid #ddd",
            }}
          >
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>
                  Property
                </th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>
                  Address
                </th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>
                  City
                </th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>
                  Occupancy
                </th>
                <th style={{ textAlign: "left", padding: "10px", borderBottom: "1px solid #ddd" }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, idx) => {
                const total = p.total_units ?? 0;
                const occupied = p.occupied_units ?? 0;
                const status = (p.status ?? "").toLowerCase();

                const statusPill =
                  status === "active"
                    ? { bg: "#e6f6ea", fg: "#1b5e20", bd: "#b7e1bf" }
                    : status === "under_renovation"
                      ? { bg: "#fff3cd", fg: "#7a5a00", bd: "#ffe69c" }
                      : { bg: "#fbe8ea", fg: "#b00020", bd: "#f3b7be" };

                return (
                  <tr key={`${p.tenant_id ?? "t"}-${idx}`}>
                    <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>
                      {p.name ?? "(no name)"}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>
                      <div>{p.address ?? "(no address)"}</div>
                      <div style={{ color: "#666", fontSize: 12 }}>
                        {p.postal_code ? `Postal code: ${p.postal_code}` : ""}
                      </div>
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>
                      {p.city ?? "(no city)"}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>
                      {occupied}/{total}{" "}
                      <span style={{ color: "#666" }}>
                        {total > 0 ? `(${Math.round((occupied / total) * 100)}%)` : "(0%)"}
                      </span>
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #f0f0f0" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: statusPill.bg,
                          color: statusPill.fg,
                          border: `1px solid ${statusPill.bd}`,
                          fontSize: 12,
                        }}
                      >
                        {p.status ?? "inactive"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}

