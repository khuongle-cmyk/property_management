"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useCustomerPortal } from "@/context/CustomerPortalContext";
import { getSupabaseClient } from "@/lib/supabase/browser";

const PETROL = "#0D4F4F";

export default function CustomerPortalProfilePage() {
  const { customerUser, company, refetch } = useCustomerPortal();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  useEffect(() => {
    setFirstName(customerUser?.first_name?.trim() ?? "");
    setLastName(customerUser?.last_name?.trim() ?? "");
    setPhone(customerUser?.phone?.trim() ?? "");
  }, [customerUser?.first_name, customerUser?.last_name, customerUser?.phone]);

  const saveProfile = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!customerUser?.id) return;
      setSaving(true);
      setProfileErr(null);
      setProfileMsg(null);
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from("customer_users")
        .update({
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          phone: phone.trim() || null,
        } as never)
        .eq("id", customerUser.id);
      setSaving(false);
      if (error) {
        setProfileErr(error.message);
        return;
      }
      setProfileMsg("Profile saved.");
      await refetch();
    },
    [customerUser?.id, firstName, lastName, phone, refetch],
  );

  const savePassword = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setPwErr(null);
      setPwMsg(null);
      if (newPassword.length < 8) {
        setPwErr("Password must be at least 8 characters.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setPwErr("Passwords do not match.");
        return;
      }
      setPwSaving(true);
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      setPwSaving(false);
      if (error) {
        setPwErr(error.message);
        return;
      }
      setPwMsg("Password updated.");
      setNewPassword("");
      setConfirmPassword("");
    },
    [newPassword, confirmPassword],
  );

  const companyName = company?.name ?? "—";
  const roleLabel = String(customerUser?.role ?? "—").replace("_", " ");

  return (
    <div style={{ display: "grid", gap: 24, maxWidth: 560 }}>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: PETROL }}>My profile</h1>

      <section
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: "20px 20px 24px",
        }}
      >
        <h2 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600, color: PETROL }}>Account</h2>
        <p style={{ margin: "0 0 8px", fontSize: 14, color: "#64748b" }}>
          <strong style={{ color: "#334155" }}>Email</strong> (sign-in){": "}
          {customerUser?.email ?? "—"}
        </p>
        <p style={{ margin: "8px 0", fontSize: 14, color: "#64748b" }}>
          <strong style={{ color: "#334155" }}>Company</strong>
          {": "}
          {companyName}
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "#64748b" }}>
          <strong style={{ color: "#334155" }}>Role</strong>
          {": "}
          <span
            style={{
              display: "inline-block",
              marginLeft: 6,
              padding: "2px 10px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              background: "#e0f2fe",
              color: "#0369a1",
              textTransform: "capitalize",
            }}
          >
            {roleLabel}
          </span>
        </p>
      </section>

      <form
        onSubmit={(e) => void saveProfile(e)}
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: "20px 20px 24px",
          display: "grid",
          gap: 14,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: PETROL }}>Your details</h2>
        <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500, color: "#334155" }}>
          First name
          <input className="vw-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500, color: "#334155" }}>
          Last name
          <input className="vw-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500, color: "#334155" }}>
          Phone
          <input className="vw-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        {profileErr ? <p style={{ margin: 0, color: "#b91c1c", fontSize: 14 }}>{profileErr}</p> : null}
        {profileMsg ? <p style={{ margin: 0, color: "#15803d", fontSize: 14 }}>{profileMsg}</p> : null}
        <div>
          <button type="submit" className="vw-btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>

      <form
        onSubmit={(e) => void savePassword(e)}
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: "20px 20px 24px",
          display: "grid",
          gap: 14,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: PETROL }}>Change password</h2>
        <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500, color: "#334155" }}>
          New password
          <input
            className="vw-input"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 14, fontWeight: 500, color: "#334155" }}>
          Confirm password
          <input
            className="vw-input"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>
        {pwErr ? <p style={{ margin: 0, color: "#b91c1c", fontSize: 14 }}>{pwErr}</p> : null}
        {pwMsg ? <p style={{ margin: 0, color: "#15803d", fontSize: 14 }}>{pwMsg}</p> : null}
        <div>
          <button type="submit" className="vw-btn-primary" disabled={pwSaving}>
            {pwSaving ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </div>
  );
}
