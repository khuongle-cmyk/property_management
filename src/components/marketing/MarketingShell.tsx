"use client";

import type { ReactNode } from "react";
import { MarketingTenantProvider, useMarketingTenant } from "@/contexts/MarketingTenantContext";
import MarketingSubNav from "@/components/marketing/MarketingSubNav";

function Inner({ children }: { children: ReactNode }) {
  const { loading, error, tenantId, tenants, isSuperAdmin, dataReady, setTenantId } = useMarketingTenant();

  if (loading) {
    return <p style={{ color: "var(--petrol, #1a4a4a)", opacity: 0.8 }}>Loading marketing…</p>;
  }

  if (error) {
    return <p style={{ color: "#b42318" }}>{error}</p>;
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <h1 style={{ margin: 0, flex: "1 1 auto", fontFamily: "var(--font-instrument-serif), serif", fontWeight: 400 }}>
          Marketing
        </h1>
        {isSuperAdmin || tenants.length > 1 ? (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            <span style={{ color: "rgba(26,74,74,0.75)" }}>Organization</span>
            <select
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid rgba(26,74,74,0.25)",
                background: "#fff",
                minWidth: 200,
              }}
            >
              {isSuperAdmin ? (
                <option value="">All organizations</option>
              ) : null}
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <MarketingSubNav />
      {!dataReady ? <p style={{ color: "#b42318" }}>Select an organization to continue.</p> : children}
    </>
  );
}

export default function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <MarketingTenantProvider>
      <Inner>{children}</Inner>
    </MarketingTenantProvider>
  );
}
