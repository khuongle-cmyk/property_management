"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";

export type CustomerCompanyRow = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  [key: string]: unknown;
};

export type CustomerUserRow = {
  id: string;
  auth_user_id: string | null;
  company_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  customer_companies: CustomerCompanyRow | CustomerCompanyRow[] | null;
};

type Ctx = {
  customerUser: CustomerUserRow | null;
  company: CustomerCompanyRow | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

const CustomerPortalContext = createContext<Ctx>({
  customerUser: null,
  company: null,
  loading: true,
  error: null,
  refetch: async () => {},
});

export function CustomerPortalProvider({ children }: { children: ReactNode }) {
  const [customerUser, setCustomerUser] = useState<CustomerUserRow | null>(null);
  const [company, setCompany] = useState<CustomerCompanyRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = getSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setCustomerUser(null);
      setCompany(null);
      setLoading(false);
      return;
    }

    const { data: row, error: qErr } = await supabase
      .from("customer_users")
      .select("*, customer_companies(*)")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (qErr) {
      setError(qErr.message);
      setCustomerUser(null);
      setCompany(null);
      setLoading(false);
      return;
    }

    const cu = row as CustomerUserRow | null;
    setCustomerUser(cu ?? null);
    const cc = cu?.customer_companies;
    if (Array.isArray(cc)) {
      setCompany((cc[0] as CustomerCompanyRow) ?? null);
    } else {
      setCompany((cc as CustomerCompanyRow) ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const value = useMemo(
    () => ({
      customerUser,
      company,
      loading,
      error,
      refetch,
    }),
    [customerUser, company, loading, error, refetch],
  );

  return <CustomerPortalContext.Provider value={value}>{children}</CustomerPortalContext.Provider>;
}

export function useCustomerPortal() {
  return useContext(CustomerPortalContext);
}
