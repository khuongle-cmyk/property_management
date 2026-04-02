"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/browser";

const STORAGE_KEY = "vw-marketing-tenant-id";
/** Persisted when super admin selects combined “All organizations” */
const STORAGE_ALL = "__all__";

const MARKETING_ROLES = new Set([
  "owner",
  "manager",
  "customer_service",
  "accounting",
  "viewer",
  "agent",
  "super_admin",
]);

type TenantOpt = { id: string; name: string };

type Ctx = {
  loading: boolean;
  error: string | null;
  tenantId: string;
  tenants: TenantOpt[];
  isSuperAdmin: boolean;
  allOrganizations: boolean;
  dataReady: boolean;
  setTenantId: (id: string) => void;
  querySuffix: string;
};

const MarketingTenantContext = createContext<Ctx | null>(null);

export function useMarketingTenant(): Ctx {
  const c = useContext(MarketingTenantContext);
  if (!c) throw new Error("useMarketingTenant outside provider");
  return c;
}

export function MarketingTenantProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenants, setTenants] = useState<TenantOpt[]>([]);
  const [tenantId, setTenantIdState] = useState("");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const setTenantId = useCallback((id: string) => {
    setTenantIdState(id);
    if (typeof window === "undefined") return;
    try {
      if (id === "") {
        window.localStorage.setItem(STORAGE_KEY, STORAGE_ALL);
      } else if (id) {
        window.localStorage.setItem(STORAGE_KEY, id);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      setLoading(true);
      setError(null);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: mem, error: mErr } = await supabase.from("memberships").select("tenant_id, role");
      if (mErr) {
        if (!cancelled) setError(mErr.message);
        if (!cancelled) setLoading(false);
        return;
      }
      const rows = (mem ?? []) as { tenant_id: string | null; role: string | null }[];
      const superA = rows.some((r) => String(r.role ?? "").toLowerCase() === "super_admin");
      const ids = [
        ...new Set(
          rows
            .filter((r) => MARKETING_ROLES.has(String(r.role ?? "").toLowerCase()))
            .map((r) => r.tenant_id)
            .filter(Boolean),
        ),
      ] as string[];
      if (!cancelled) setIsSuperAdmin(superA);
      if (!superA && ids.length === 0) {
        if (!cancelled) {
          setError("You do not have access to Marketing.");
          setTenants([]);
          setTenantIdState("");
        }
        if (!cancelled) setLoading(false);
        return;
      }

      let list: TenantOpt[] = [];
      if (superA) {
        const { data: tRows, error: tErr } = await supabase.from("tenants").select("id,name").order("name", { ascending: true });
        if (tErr) {
          if (!cancelled) setError(tErr.message);
          if (!cancelled) setLoading(false);
          return;
        }
        list = ((tRows ?? []) as TenantOpt[]).filter(Boolean);
      } else {
        const { data: tRows, error: tErr } = await supabase
          .from("tenants")
          .select("id,name")
          .in("id", ids)
          .order("name", { ascending: true });
        if (tErr) {
          if (!cancelled) setError(tErr.message);
          if (!cancelled) setLoading(false);
          return;
        }
        list = ((tRows ?? []) as TenantOpt[]).filter(Boolean);
      }

      let initial = "";
      try {
        const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
        if (saved === STORAGE_ALL && (superA || list.length > 1)) {
          initial = "";
        } else if (saved && list.some((t) => t.id === saved)) {
          initial = saved;
        } else if (superA) {
          initial = "";
        } else if (list[0]) {
          initial = list[0].id;
        }
      } catch {
        if (superA) initial = "";
        else if (list[0]) initial = list[0].id;
      }
      if (!superA && !initial && list[0]) initial = list[0].id;

      if (!cancelled) {
        setTenants(list);
        setTenantIdState(initial);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const canPickAllOrganizations = isSuperAdmin || tenants.length > 1;
  const allOrganizations = tenantId === "" && canPickAllOrganizations;

  const querySuffix = useMemo(() => {
    if (allOrganizations) return "?allOrganizations=1";
    if (!tenantId) return "";
    return `?tenantId=${encodeURIComponent(tenantId)}`;
  }, [tenantId, allOrganizations]);

  const dataReady = !loading && !error && (tenantId !== "" || allOrganizations);

  const value = useMemo(
    () => ({
      loading,
      error,
      tenantId,
      tenants,
      isSuperAdmin,
      allOrganizations,
      dataReady,
      setTenantId,
      querySuffix,
    }),
    [loading, error, tenantId, tenants, isSuperAdmin, allOrganizations, dataReady, setTenantId, querySuffix],
  );

  return <MarketingTenantContext.Provider value={value}>{children}</MarketingTenantContext.Provider>;
}
