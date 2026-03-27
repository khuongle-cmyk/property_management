import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type SupabasePropertyRow = {
  name: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  total_units: number | null;
  occupied_units: number | null;
  status: string | null;
  tenant_id: string | null;
};

export function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const cookieStorePromise = cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      async getAll() {
        const cookieStore = await cookieStorePromise;
        return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      async setAll(cookiesToSet) {
        const cookieStore = await cookieStorePromise;
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set({ name, value, ...(options ?? {}) });
        });
      },
    },
  });
}

export type { SupabasePropertyRow };

