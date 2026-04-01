"use client";

/**
 * ConfirmDialog — reusable branded confirmation modal
 *
 * Usage:
 * <ConfirmDialog
 *   open={showConfirm}
 *   title="Delete offer?"
 *   message="This cannot be undone."
 *   confirmLabel="Delete"
 *   confirmDanger={true}
 *   onConfirm={() => handleDelete()}
 *   onCancel={() => setShowConfirm(false)}
 * />
 */

import { useEffect } from "react";
import { VILLAGEWORKS_BRAND } from "@/lib/brand/villageworks";

const c = VILLAGEWORKS_BRAND.colors;

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmDanger = false,
  variant = "confirm",
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) {
      if (e.key === "Escape") onCancel?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const isInfo = variant === "info";
  const confirmBg = isInfo ? c.primary : confirmDanger ? c.danger : c.primary;

  return (
    <div
      role="presentation"
      onClick={() => onCancel?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.45)",
        animation: "confirmDialogFadeIn 0.2s ease-out forwards",
      }}
    >
      <style>{`
        @keyframes confirmDialogFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: c.white,
          borderRadius: 16,
          padding: 32,
          maxWidth: 400,
          width: "90%",
          boxSizing: "border-box",
        }}
      >
        <div id="confirm-dialog-title" style={{ fontSize: 18, fontWeight: 700, color: c.text }}>
          {title}
        </div>
        {message ? (
          <div style={{ fontSize: 14, color: c.text, opacity: 0.75, marginTop: 8, lineHeight: 1.45 }}>{message}</div>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24, flexWrap: "wrap" }}>
          {!isInfo ? (
            <button
              type="button"
              onClick={() => onCancel?.()}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: `1px solid ${c.border}`,
                background: c.white,
                color: c.text,
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              {cancelLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onConfirm?.()}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              background: confirmBg,
              color: c.white,
              fontWeight: 600,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {isInfo ? confirmLabel || "Got it" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
