"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { CustomerImportModal } from "@/components/crm/CustomerImportModal";

type MembershipRow = { tenant_id: string | null; role: string | null };

export default function CrmImportPage() {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setError("Unauthorized");
          setLoading(false);
        }
        return;
      }
      const { data: mRows, error: mErr } = await supabase.from("memberships").select("tenant_id, role").eq("user_id", user.id);
      if (cancelled) return;
      if (mErr) {
        setError(mErr.message);
        setLoading(false);
        return;
      }
      const memberships = (mRows ?? []) as MembershipRow[];
      const preferred = memberships.find((m) => m.tenant_id && ["super_admin", "owner", "manager"].includes((m.role ?? "").toLowerCase()));
      setTenantId(preferred?.tenant_id ?? memberships.find((m) => m.tenant_id)?.tenant_id ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  if (loading) return <p>Loading import page…</p>;
  if (error) return <p style={{ color: "#b91c1c" }}>{error}</p>;

  return (
    <main style={{ display: "grid", gap: 12 }}>
      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Import contacts</h1>
        <p style={{ marginBottom: 0, color: "#64748b" }}>
          Use this page to import contacts from CSV/XLSX into the CRM pipeline.
        </p>
        <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
          <Link href="/crm">CRM Pipeline</Link>
          <Link href="/crm/contacts">Contacts</Link>
          <Link href="/crm/import" style={{ fontWeight: 700 }}>Import contacts</Link>
        </div>
      </section>
      <button type="button" onClick={() => setOpen(true)} style={{ width: "fit-content", padding: "10px 12px" }}>
        Open importer
      </button>
      <CustomerImportModal open={open} tenantId={tenantId} onClose={() => setOpen(false)} onImported={async () => {}} />
    </main>
  );
}
