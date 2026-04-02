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
      className="pointer-events-none fixed z-50 flex flex-col items-end gap-4"
      style={{
        bottom: "max(24px, env(safe-area-inset-bottom, 0px))",
        right: "max(24px, env(safe-area-inset-right, 0px))",
      }}
    >
      <div
        className={`mb-0 flex flex-col-reverse items-end gap-16 ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      >
        {actions.map((action, i) => {
          const Icon = action.icon;
          const delay = STAGGER_MS[i] ?? 100;
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
              <span className="pointer-events-none whitespace-nowrap rounded-md border border-[#e5e5e0] bg-white px-2.5 py-1 text-xs font-medium text-gray-800 shadow-md">
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
        className={`pointer-events-auto flex shrink-0 items-center justify-center rounded-full text-white shadow-lg transition-all duration-200 ease-out hover:opacity-95 ${open ? "rotate-45" : "rotate-0"}`}
        style={{
          backgroundColor: PETROL,
          width: 56,
          height: 56,
        }}
      >
        <Plus size={28} strokeWidth={2} aria-hidden className="text-white" />
      </button>
    </div>
  );
}
