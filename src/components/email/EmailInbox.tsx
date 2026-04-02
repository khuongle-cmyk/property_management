"use client";

import { useCallback, useMemo, useState } from "react";
import EmailThreadDetail from "@/components/email/EmailThreadDetail";
import {
  MOCK_THREADS,
  VW_PROPERTIES,
  propertyById,
  type MockThread,
  type ThreadStatus,
  type VwPropertyId,
} from "@/lib/email/mock-dashboard-data";

const STATUS_FILTERS: Array<{ id: ThreadStatus | "all"; label: string }> = [
  { id: "needs_reply", label: "Needs reply" },
  { id: "awaiting", label: "Awaiting" },
  { id: "all", label: "All" },
];

function statusBadgeClasses(status: ThreadStatus): string {
  if (status === "needs_reply") return "bg-red-100 text-red-800 border-red-200";
  if (status === "awaiting") return "bg-amber-100 text-amber-900 border-amber-200";
  return "bg-emerald-100 text-emerald-900 border-emerald-200";
}

function statusLabel(status: ThreadStatus): string {
  if (status === "needs_reply") return "Needs reply";
  if (status === "awaiting") return "Awaiting response";
  return "Replied";
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fi-FI", { dateStyle: "short", timeStyle: "short" });
}

type Props = {
  onCompose: () => void;
};

export default function EmailInbox({ onCompose }: Props) {
  const [propertyFilter, setPropertyFilter] = useState<VwPropertyId | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ThreadStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());

  const threads = useMemo(() => {
    let list = [...MOCK_THREADS];
    if (propertyFilter !== "all") {
      list = list.filter((t) => t.propertyId === propertyFilter);
    }
    if (statusFilter !== "all") {
      list = list.filter((t) => t.status === statusFilter);
    }
    list.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    return list;
  }, [propertyFilter, statusFilter]);

  const selectedThread = useMemo(
    () => (selectedId ? threads.find((t) => t.id === selectedId) ?? MOCK_THREADS.find((t) => t.id === selectedId) ?? null : null),
    [selectedId, threads],
  );

  const markRead = useCallback((threadId: string) => {
    setReadIds((prev) => {
      if (prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.add(threadId);
      return next;
    });
  }, []);

  function isUnread(t: MockThread): boolean {
    if (readIds.has(t.id)) return false;
    return Boolean(t.unread);
  }

  return (
    <div className="relative">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium text-[var(--petrol,#1a4a4a)]/80">
            <span className="sr-only">Property</span>
            <select
              value={propertyFilter}
              onChange={(e) => setPropertyFilter(e.target.value as VwPropertyId | "all")}
              className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-[var(--petrol,#1a4a4a)] shadow-sm focus:border-[#1a5c50] focus:outline-none focus:ring-2 focus:ring-[#1a5c50]/20"
            >
              <option value="all">All properties</option>
              {VW_PROPERTIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.short}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Status filter">
          {STATUS_FILTERS.map((s) => {
            const active = statusFilter === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStatusFilter(s.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "border-[#1a5c50] bg-[#1a5c50] text-white"
                    : "border-stone-200 bg-white text-[var(--petrol,#1a4a4a)] hover:bg-stone-50"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onCompose}
          className="rounded-lg border border-[#1a5c50] bg-[#1a5c50] px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#164e44]"
        >
          Compose
        </button>
      </div>

      <ul className="mt-6 divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        {threads.map((t: MockThread) => {
          const prop = propertyById(t.propertyId);
          const selected = selectedId === t.id;
          const unread = isUnread(t);
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setSelectedId(t.id)}
                className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-[#faf9f6] ${
                  selected ? "bg-[#eef6f4] ring-2 ring-inset ring-[#1a5c50]/25" : ""
                }`}
              >
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{ background: "var(--petrol-mid, #1f5c5c)" }}
                >
                  {t.senderInitials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {unread ? (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-sky-600" title="Unread" aria-hidden />
                    ) : null}
                    <span className={`font-semibold text-[var(--petrol,#1a4a4a)] ${unread ? "font-bold" : ""}`}>
                      {t.senderName}
                    </span>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${prop.badgeClass}`}
                    >
                      {prop.short}
                    </span>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusBadgeClasses(t.status)}`}
                    >
                      {statusLabel(t.status)}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-stone-500">{formatTs(t.updatedAt)}</span>
                  </div>
                  <div className={`mt-0.5 truncate text-sm text-[var(--petrol,#1a4a4a)] ${unread ? "font-semibold" : "font-medium"}`}>
                    {t.subject}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-sm text-stone-600">{t.preview}</div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {threads.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-stone-300 bg-[#faf9f6] px-4 py-8 text-center text-sm text-stone-600">
          No threads match these filters.
        </p>
      ) : null}

      <EmailThreadDetail
        thread={selectedThread}
        open={Boolean(selectedThread)}
        onClose={() => setSelectedId(null)}
        onMarkRead={markRead}
      />
    </div>
  );
}
