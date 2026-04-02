"use client";

import { MOCK_PROPERTY_TABLE, MOCK_TEAM, propertyById } from "@/lib/email/mock-dashboard-data";

export default function EmailPropertyOverview() {
  const kpis = {
    total30d: 164,
    avgResponseHours: 2.7,
    openRatePct: 64,
    staleThreads: 3,
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total emails (30d)", value: String(kpis.total30d) },
          { label: "Avg response time", value: `${kpis.avgResponseHours.toFixed(1)} h` },
          { label: "Open rate", value: `${kpis.openRatePct}%` },
          { label: "Stale threads", value: String(kpis.staleThreads) },
        ].map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-stone-200 bg-gradient-to-br from-white to-[#faf9f6] px-4 py-4 shadow-sm"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{k.label}</div>
            <div className="mt-2 text-3xl font-semibold text-[var(--petrol,#1a4a4a)]">{k.value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-[#faf9f6]">
              <th className="px-4 py-3 font-semibold text-[var(--petrol,#1a4a4a)]">Property</th>
              <th className="px-4 py-3 font-semibold text-[var(--petrol,#1a4a4a)]">Sent</th>
              <th className="px-4 py-3 font-semibold text-[var(--petrol,#1a4a4a)]">Received</th>
              <th className="px-4 py-3 font-semibold text-[var(--petrol,#1a4a4a)]">Needs reply</th>
              <th className="px-4 py-3 font-semibold text-[var(--petrol,#1a4a4a)]">Avg response</th>
              <th className="px-4 py-3 font-semibold text-[var(--petrol,#1a4a4a)]">Open rate</th>
              <th className="px-4 py-3 font-semibold text-[var(--petrol,#1a4a4a)]">Alert</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_PROPERTY_TABLE.map((row) => {
              const p = propertyById(row.propertyId);
              return (
                <tr key={row.propertyId} className="border-b border-stone-100 hover:bg-[#faf9f6]/80">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--petrol,#1a4a4a)]">{p.short}</div>
                    <div className="text-xs text-stone-500">{p.legalName}</div>
                  </td>
                  <td className="px-4 py-3 text-stone-800">{row.sent}</td>
                  <td className="px-4 py-3 text-stone-800">{row.received}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        row.needsReply > 2
                          ? "font-semibold text-red-700"
                          : "text-stone-800"
                      }
                    >
                      {row.needsReply}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-stone-800">{row.avgResponseHours.toFixed(1)} h</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-stone-200">
                        <div
                          className="h-full rounded-full bg-[#1a5c50]"
                          style={{ width: `${row.openRatePct}%` }}
                        />
                      </div>
                      <span className="text-stone-700">{row.openRatePct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {row.alert ? (
                      <span className="inline-block h-3 w-3 rounded-full bg-red-500 shadow-sm" title="Attention" />
                    ) : (
                      <span className="inline-block h-3 w-3 rounded-full bg-stone-300" title="OK" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="mb-3 text-base font-semibold text-[var(--petrol,#1a4a4a)]">Team performance</h3>
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full min-w-[480px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-[#faf9f6]">
                <th className="px-4 py-3 font-semibold text-[var(--petrol,#1a4a4a)]">Team member</th>
                <th className="px-4 py-3 font-semibold text-[var(--petrol,#1a4a4a)]">Emails handled</th>
                <th className="px-4 py-3 font-semibold text-[var(--petrol,#1a4a4a)]">Avg reply time</th>
                <th className="px-4 py-3 font-semibold text-[var(--petrol,#1a4a4a)]">Pending</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_TEAM.map((m) => (
                <tr key={m.name} className="border-b border-stone-100 hover:bg-[#faf9f6]/80">
                  <td className="px-4 py-3 font-medium text-[var(--petrol,#1a4a4a)]">{m.name}</td>
                  <td className="px-4 py-3 text-stone-800">{m.emailsHandled}</td>
                  <td className="px-4 py-3 text-stone-800">{m.avgReplyHours.toFixed(1)} h</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        m.pending > 3 ? "font-semibold text-amber-800" : "text-stone-800"
                      }
                    >
                      {m.pending}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
