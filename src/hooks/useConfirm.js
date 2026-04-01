"use client";

import { useCallback, useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

/**
 * Returns [ConfirmModal, confirmFn]
 *
 * Usage:
 * const [ConfirmModal, confirm] = useConfirm()
 * await confirm({ title: 'Delete?', message: '...', confirmDanger: true })
 * <ConfirmModal />
 *
 * Info dialog (single “Got it”, primary button):
 * await confirm({ variant: 'info', title: '...', message: '...', confirmLabel: 'Got it' })
 */
export function useConfirm() {
  const [dialog, setDialog] = useState(null);
  const resolveRef = useRef(null);
  const dialogRef = useRef(null);
  dialogRef.current = dialog;

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({
        variant: options.variant ?? "confirm",
        title: options.title ?? "",
        message: options.message ?? "",
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel ?? "Cancel",
        confirmDanger: Boolean(options.confirmDanger),
      });
    });
  }, []);

  const close = useCallback((value) => {
    const r = resolveRef.current;
    resolveRef.current = null;
    setDialog(null);
    r?.(value);
  }, []);

  const handleCancel = useCallback(() => {
    const current = dialogRef.current;
    const isInfo = current?.variant === "info";
    close(isInfo ? undefined : false);
  }, [close]);

  const handleConfirm = useCallback(() => {
    close(true);
  }, [close]);

  function ConfirmModal() {
    if (!dialog) return null;
    const isInfo = dialog.variant === "info";
    return (
      <ConfirmDialog
        open
        variant={isInfo ? "info" : "confirm"}
        title={dialog.title}
        message={dialog.message}
        confirmLabel={dialog.confirmLabel ?? (isInfo ? "Got it" : "Confirm")}
        cancelLabel={dialog.cancelLabel}
        confirmDanger={dialog.confirmDanger}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    );
  }

  return [ConfirmModal, confirm];
}
