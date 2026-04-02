"use client";

import { useMemo, useState } from "react";
import {
  MOCK_COMPANY_OPTIONS,
  MOCK_TIMELINE_BY_COMPANY,
  propertyById,
  type MockTimelineEntry,
} from "@/lib/email/mock-dashboard-data";

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fi-FI", { dateStyle: "medium", timeStyle: "short" });
}

export default function EmailCompanyTimeline() {
  const [companyId, setCompanyId] = useState(MOCK_COMPANY_OPTIONS[0]?.id ?? "");

  const entries = useMemo(() => {
    const raw = MOCK_TIMELINE_BY_COMPANY[companyId] ?? [];
    return [...raw].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }, [companyId]);

  const stats = useMemo(() => {
    const total = entries.length;
    const opened = entries.filter((e) => e.opened).length;
    const openRate = total ? Math.round((opened / total) * 100) : 0;
    return {
      totalEmails: total,
      avgResponseHours: total ? 2.6 : 0,
      openRatePct: openRate,
      activeThreads: Math.min(total, 3),
    };
  }, [entries]);

  return (
    <div className="space-y-6">
      <div className="flex max-w-xl flex-col gap-2">
        <label className="text-sm font-medium text-[var(--petrol,#1a4a4a)]" htmlFor="company-timeline-select">
          Company
        </label>
        <select
          id="company-timeline-select"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-[var(--petrol,#1a4a4a)] shadow-sm focus:border-[#1a5c50] focus:outline-none focus:ring-2 focus:ring-[#1a5c50]/20"
        >
          {MOCK_COMPANY_OPTIONS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-stone-500">Search / filter will connect to CRM when Gmail is integrated.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total emails", value: String(stats.totalEmails) },
          { label: "Avg response time", value: `${stats.avgResponseHours.toFixed(1)} h` },
          { label: "Open rate", value: `${stats.openRatePct}%` },
          { label: "Active threads", value: String(stats.activeThreads) },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{kpi.label}</div>
            <div className="mt-1 text-2xl font-semibold text-[var(--petrol,#1a4a4a)]">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-[var(--petrol,#1a4a4a)]">Timeline</h3>
        {entries.length === 0 ? (
          <p className="mt-4 text-sm text-stone-600">No emails for this company yet (mock).</p>
        ) : (
          <ol className="relative mt-6 border-l border-stone-200 pl-6">
            {entries.map((e: MockTimelineEntry) => {
              const prop = propertyById(e.propertyId);
              return (
                <li key={e.id} className="relative mb-8 ml-2 last:mb-2">
                  <span
                    className={`absolute -left-[9px] mt-1.5 h-3 w-3 rounded-full border-2 border-white ${
                      e.direction === "in" ? "bg-emerald-500" : "bg-sky-600"
                    }`}
                    title={e.direction === "in" ? "Received" : "Sent"}
                  />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                    <time dateTime={e.at}>{formatTs(e.at)}</time>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${prop.badgeClass}`}>
                      {prop.short}
                    </span>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-700">
                      {e.staffName}
                    </span>
                    {e.opened ? (
                      <span className="text-emerald-700">Opened</span>
                    ) : (
                      <span className="text-stone-400">Not opened</span>
                    )}
                  </div>
                  <div className="mt-1 text-sm font-medium text-[var(--petrol,#1a4a4a)]">{e.subject}</div>
                  <div className="mt-0.5 text-xs text-stone-600">
                    <span className="font-medium text-stone-700">{e.direction === "in" ? "From" : "To"}:</span>{" "}
                    {e.direction === "in" ? e.from : e.to}
                  </div>
                  <p className="mt-1 text-sm text-stone-600">{e.preview}</p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
