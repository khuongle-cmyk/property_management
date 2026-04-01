"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { useBrand } from "@/components/BrandProvider";
import { setAppScopeCookie, setUserTypeCookie } from "@/lib/auth/user-type-cookie";
import { getSupabaseClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const { brand } = useBrand();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = getSupabaseClient();
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signErr) {
        setLoading(false);
        setError(signErr.message);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        setError("Could not load session.");
        return;
      }

      const { data: customerRow, error: cuErr } = await supabase
        .from("customer_users")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (cuErr) {
        setLoading(false);
        setError(cuErr.message);
        await supabase.auth.signOut();
        return;
      }

      if (customerRow) {
        setUserTypeCookie("customer");
        setAppScopeCookie("portal");
        router.push("/portal");
        setLoading(false);
        return;
      }

      const { data: memberships, error: mErr } = await supabase.from("memberships").select("role");
      if (mErr) {
        setLoading(false);
        setError(mErr.message);
        await supabase.auth.signOut();
        return;
      }

      const roles = (memberships ?? []).map((m) => (m.role ?? "").toLowerCase());
      if (roles.length === 0) {
        setLoading(false);
        setError("Account not found");
        await supabase.auth.signOut();
        return;
      }

      setUserTypeCookie("admin");

      const dashboardRoles = new Set(["super_admin", "admin", "owner", "manager"]);
      const hasDashboardAccess = roles.some((r) => dashboardRoles.has(r));

      if (hasDashboardAccess) {
        setAppScopeCookie("dashboard");
        router.push("/dashboard");
        setLoading(false);
        return;
      }

      setAppScopeCookie("workspace");
      router.push("/bookings");
      setLoading(false);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Failed to sign in.");
    }
  }

  return (
    <main
      style={{
        maxWidth: 560,
        margin: "0 auto",
        borderRadius: 16,
        border: "1px solid #dce8e8",
        background: "#fff",
        boxShadow: "0 12px 28px rgba(0,0,0,0.08)",
        overflow: "hidden",
      }}
    >
      {brand.login_page_background_image_url ? (
        <div style={{ height: 150, backgroundImage: `url(${brand.login_page_background_image_url})`, backgroundSize: "cover", backgroundPosition: "center" }} />
      ) : null}
      <div style={{ padding: 18 }}>
        {brand.logo_url ? <img src={brand.logo_url} alt={brand.brand_name} style={{ maxWidth: 220, width: "100%", height: "auto", marginBottom: 10 }} /> : null}
        <h1 style={{ margin: "0 0 8px", color: brand.text_color }}>{brand.login_page_headline ?? `Sign in to ${brand.brand_name}`}</h1>
        <p style={{ marginTop: 0, marginBottom: 18, color: "#4f6665" }}>
          {brand.login_page_subheadline ?? "Continue to your workspace dashboard."}
        </p>

        <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </label>

          {error ? (
            <p style={{ margin: 0, color: "#b00020" }}>{error}</p>
          ) : (
            <div style={{ height: 18 }} />
          )}

          <button
            disabled={loading}
            type="submit"
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: `1px solid ${brand.primary_color}`,
              background: brand.primary_color,
              color: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        {!brand.hide_powered_by ? (
          <p style={{ marginBottom: 0, marginTop: 10, fontSize: 12, color: "#6e8484" }}>
            {brand.powered_by_text}
          </p>
        ) : null}
      </div>
    </main>
  );
}
