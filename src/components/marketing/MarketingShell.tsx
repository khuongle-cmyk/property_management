"use client";

import type { ReactNode } from "react";
import { MarketingTenantProvider, useMarketingTenant } from "@/contexts/MarketingTenantContext";
import MarketingNav from "@/components/marketing/MarketingNav";

function Inner({ children }: { children: ReactNode }) {
  const { loading, error, tenantId, tenants, isSuperAdmin, dataReady, setTenantId } = useMarketingTenant();

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] p-6">
        <p className="text-sm text-gray-500">Loading marketing…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[1400px] p-6">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  const orgSelectValue = isSuperAdmin ? (tenantId === "" ? "all" : tenantId) : tenantId;

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="vw-admin-page-title">Marketing</h1>
        {isSuperAdmin || tenants.length > 1 ? (
          <label className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span>Organization</span>
            <select
              value={orgSelectValue}
              onChange={(e) => {
                const v = e.target.value;
                setTenantId(v === "all" ? "" : v);
              }}
              style={{
                border: "1px solid #d1d5db",
                borderRadius: "8px",
                padding: "8px 12px",
                backgroundColor: "#fff",
                color: "#111827",
                minWidth: "200px",
                fontSize: "14px",
              }}
            >
              {isSuperAdmin ? <option value="all">All organizations</option> : null}
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <MarketingNav />

      {!dataReady ? (
        <p className="text-sm text-gray-500">Select an organization to continue.</p>
      ) : (
        children
      )}
    </div>
  );
}

export default function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <MarketingTenantProvider>
      <Inner>{children}</Inner>
    </MarketingTenantProvider>
  );
}
