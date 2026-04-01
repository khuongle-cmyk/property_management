"use client";

import { getSupabaseClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  async function onLogout() {
    const { clearAuthCookies } = await import("@/lib/auth/user-type-cookie");
    clearAuthCookies();
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <button
      onClick={onLogout}
      type="button"
      style={{
        padding: "8px 12px",
        borderRadius: 10,
        border: "1px solid #ddd",
        background: "#fff",
        color: "#111",
        cursor: "pointer",
      }}
    >
      Sign out
    </button>
  );
}

