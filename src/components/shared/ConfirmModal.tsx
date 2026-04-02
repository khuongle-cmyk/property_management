"use client";

import { useEffect } from "react";

export type ConfirmModalProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(2px)",
      }}
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="mx-4 w-full max-w-[400px] overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <div className="px-6 pb-2 pt-6">
          <h2 id="confirm-modal-title" className="text-lg font-semibold" style={{ color: "#1a1a1a" }}>
            {title}
          </h2>
        </div>
        <div className="px-6 pb-4">
          <p className="text-sm" style={{ color: "#666" }}>
            {message}
          </p>
        </div>
        <div className="flex justify-end gap-3 px-6 pb-6">
          <button
            type="button"
            className="rounded-lg border border-[#e5e5e0] bg-white px-4 py-2 text-sm font-medium text-[#666] transition-colors hover:bg-[#f5f5f0]"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={
              variant === "danger"
                ? "rounded-lg bg-[#dc2626] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#b91c1c]"
                : "rounded-lg bg-[#1a5c50] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#164e44]"
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
