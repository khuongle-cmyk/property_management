"use client";

import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";

export type FloatingMenuAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
};

const PETROL = "#1a5c50";
const STAGGER_MS = [50, 100, 150] as const;

type FloatingActionMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: FloatingMenuAction[];
};

export default function FloatingActionMenu({ open, onOpenChange, actions }: FloatingActionMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open, onOpenChange]);

  return (
    <div
      ref={rootRef}
      className="pointer-events-none fixed z-50 flex flex-col items-end"
      style={{
        bottom: "max(24px, calc(env(safe-area-inset-bottom) + 16px))",
        right: "max(24px, calc(env(safe-area-inset-right) + 16px))",
      }}
    >
      <div
        className={`mb-4 flex flex-col-reverse items-end gap-16 ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      >
        {actions.map((action, i) => {
          const Icon = action.icon;
          const delay = STAGGER_MS[i] ?? 150;
          return (
            <div
              key={action.id}
              className="flex flex-row-reverse items-center gap-2"
              style={{
                transition: "transform 200ms ease-out, opacity 200ms ease-out",
                transitionDelay: open ? `${delay}ms` : "0ms",
                transform: open ? "scale(1) translateY(0)" : "scale(0) translateY(16px)",
                opacity: open ? 1 : 0,
              }}
            >
              <button
                type="button"
                aria-label={action.label}
                title={action.label}
                onClick={() => {
                  action.onClick();
                  onOpenChange(false);
                }}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-md transition-colors hover:opacity-90"
                style={{ backgroundColor: PETROL }}
              >
                <Icon size={22} strokeWidth={2} aria-hidden />
              </button>
              <span className="pointer-events-none rounded border border-gray-100 bg-white px-2 py-0.5 text-xs font-medium text-gray-800 shadow-sm">
                {action.label}
              </span>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        aria-label={open ? "Close actions" : "Open actions"}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="pointer-events-auto flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white shadow-lg transition-all duration-200 ease-out hover:opacity-95"
        style={{
          backgroundColor: PETROL,
          transform: open ? "rotate(45deg)" : "rotate(0deg)",
        }}
      >
        <Plus size={28} strokeWidth={2} aria-hidden className="text-white" />
      </button>
    </div>
  );
}
