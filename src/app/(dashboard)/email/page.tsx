"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import EmailCompanyTimeline from "@/components/email/EmailCompanyTimeline";
import EmailCompose from "@/components/email/EmailCompose";
import EmailInbox from "@/components/email/EmailInbox";
import EmailPropertyOverview from "@/components/email/EmailPropertyOverview";

type Tab = "inbox" | "timeline" | "properties";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "timeline", label: "Company timeline" },
  { id: "properties", label: "Property overview" },
];

function EmailDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("inbox");
  const [composeOpen, setComposeOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("compose") === "1") {
      setComposeOpen(true);
      setTab("inbox");
      router.replace("/email", { scroll: false });
    }
  }, [searchParams, router]);

  return (
    <DashboardLayout>
      <header className="border-b border-stone-200/80 pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Communications</p>
        <h1 className="vw-admin-page-title mt-1">Email</h1>
        <p className="mt-2 max-w-2xl text-sm text-stone-600">
          VillageWorks inbox and routing (mock data). Gmail connection coming soon.
        </p>
      </header>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-stone-200 pb-px" role="tablist" aria-label="Email views">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`relative rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-white text-[var(--petrol,#1a4a4a)] shadow-[0_-1px_0_0_white] ring-1 ring-stone-200"
                  : "text-stone-600 hover:bg-white/60 hover:text-[var(--petrol,#1a4a4a)]"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        className="rounded-b-xl rounded-tr-xl border border-t-0 border-stone-200 bg-white p-4 shadow-sm sm:p-6"
        role="tabpanel"
      >
        {tab === "inbox" ? <EmailInbox onCompose={() => setComposeOpen(true)} /> : null}
        {tab === "timeline" ? <EmailCompanyTimeline /> : null}
        {tab === "properties" ? <EmailPropertyOverview /> : null}
      </div>

      <EmailCompose open={composeOpen} onClose={() => setComposeOpen(false)} />
    </DashboardLayout>
  );
}

export default function EmailDashboardPage() {
  return (
    <Suspense
      fallback={
        <DashboardLayout>
          <p className="py-12 text-center text-sm text-stone-500">Loading…</p>
        </DashboardLayout>
      }
    >
      <EmailDashboardContent />
    </Suspense>
  );
}
