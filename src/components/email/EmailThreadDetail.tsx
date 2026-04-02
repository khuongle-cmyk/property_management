"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmailRichToolbar from "@/components/email/EmailRichToolbar";
import { EMAIL_TEMPLATE_HTML } from "@/components/email/email-rich-shared";
import {
  MOCK_EMAIL_TEMPLATES,
  getMockThreadDetail,
  propertyById,
  type DetailThreadStatus,
  type MockThread,
  type MockThreadDetail,
  type MockThreadMessage,
} from "@/lib/email/mock-dashboard-data";

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dateGroupLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  if (sameCalendarDay(d, today)) return "Today";
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (sameCalendarDay(d, y)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fi-FI", { dateStyle: "medium", timeStyle: "short" });
}

function relativeTimeLabel(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMs = Date.now() - t;
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function groupMessagesByDate(messages: MockThreadMessage[]): { label: string; items: MockThreadMessage[] }[] {
  const map = new Map<string, MockThreadMessage[]>();
  for (const m of messages) {
    const label = dateGroupLabel(m.at);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(m);
  }
  return [...map.entries()].map(([label, items]) => ({ label, items }));
}

type Props = {
  thread: MockThread | null;
  open: boolean;
  onClose: () => void;
  onMarkRead?: (threadId: string) => void;
};

type ReplyMode = "reply" | "reply_all" | "forward";

const STATUS_OPTIONS: { value: DetailThreadStatus; label: string }[] = [
  { value: "needs_reply", label: "Needs reply" },
  { value: "awaiting", label: "Awaiting response" },
  { value: "closed", label: "Closed" },
];

function MessageCard({
  msg,
  expanded,
  onToggle,
}: {
  msg: MockThreadMessage;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isOut = msg.direction === "out";
  const border = isOut ? "border-l-sky-600" : "border-l-emerald-600";

  return (
    <article
      className={`rounded-lg border border-stone-200 bg-white shadow-sm ${border} border-l-4`}
    >
      <div className="px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {isOut ? "Sent" : "Received"}
            </div>
            <div className="mt-1 text-sm font-medium text-[var(--petrol,#1a4a4a)]">
              {msg.fromName}{" "}
              <span className="font-normal text-stone-600">&lt;{msg.fromEmail}&gt;</span>
            </div>
            <div className="text-xs text-stone-600">
              <span className="font-medium text-stone-700">To:</span> {msg.toLine}
            </div>
          </div>
          <div className="text-right text-xs text-stone-500">
            <div>{formatAbsolute(msg.at)}</div>
            <div className="text-stone-400">{relativeTimeLabel(msg.at)}</div>
          </div>
        </div>

        <div
          className={`email-thread-body mt-3 max-w-none text-sm leading-relaxed text-stone-800 [&_a]:text-[#1a5c50] [&_p]:mb-2 [&_strong]:text-[var(--petrol,#1a4a4a)] [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 ${msg.longBody && !expanded ? "max-h-[4.5rem] overflow-hidden" : ""}`}
          dangerouslySetInnerHTML={{ __html: msg.bodyHtml }}
        />

        {msg.longBody ? (
          <button
            type="button"
            onClick={onToggle}
            className="mt-2 text-xs font-medium text-[#1a5c50] hover:underline"
          >
            {expanded ? "Show less" : "Show full message"}
          </button>
        ) : null}

        {msg.attachments?.length ? (
          <ul className="mt-3 flex flex-col gap-2 border-t border-stone-100 pt-3">
            {msg.attachments.map((a) => (
              <li
                key={a.name}
                className="flex items-center justify-between gap-2 rounded-md bg-stone-50 px-2 py-1.5 text-xs"
              >
                <span className="truncate font-medium text-stone-800">{a.name}</span>
                <span className="shrink-0 text-stone-500">{a.sizeLabel}</span>
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-stone-500 hover:bg-stone-200 hover:text-[var(--petrol,#1a4a4a)]"
                  title="Download (mock)"
                  aria-label={`Download ${a.name}`}
                >
                  ⬇
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {isOut && msg.tracking ? (
          <p className="mt-2 text-[11px] text-stone-500">
            Opened {msg.tracking.openCount}× · Last opened {msg.tracking.lastOpenedLabel}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export default function EmailThreadDetail({ thread, open, onClose, onMarkRead }: Props) {
  const detail: MockThreadDetail | null = useMemo(() => (thread ? getMockThreadDetail(thread) : null), [thread]);

  const [detailStatus, setDetailStatus] = useState<DetailThreadStatus>("needs_reply");
  const [starred, setStarred] = useState(false);
  const [assigned, setAssigned] = useState("Mariia");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [replyMode, setReplyMode] = useState<ReplyMode>("reply");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showTemplatePick, setShowTemplatePick] = useState(false);
  const replyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!thread) return;
    const d = getMockThreadDetail(thread);
    setDetailStatus(d.detailStatus);
    setStarred(d.starred);
    setAssigned(d.assignedTo.name);
    setExpandedIds(new Set());
    setReplyMode("reply");
    setShowCcBcc(false);
    setCc("");
    setBcc("");
    onMarkRead?.(thread.id);
    queueMicrotask(() => {
      if (replyRef.current) replyRef.current.innerHTML = "<p></p>";
    });
  }, [thread?.id, onMarkRead]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const applyTemplate = useCallback((tid: string) => {
    if (!replyRef.current) return;
    replyRef.current.innerHTML = EMAIL_TEMPLATE_HTML[tid] ?? "<p></p>";
    setShowTemplatePick(false);
  }, []);

  const handleSendReply = () => {
    console.log("[Email thread] send", {
      threadId: thread?.id,
      mode: replyMode,
      cc: showCcBcc ? cc : undefined,
      bcc: showCcBcc ? bcc : undefined,
      bodyHtml: replyRef.current?.innerHTML ?? "",
      status: detailStatus,
      assigned,
    });
  };

  if (!open || !thread || !detail) return null;

  const prop = propertyById(detail.propertyId);
  const grouped = groupMessagesByDate(detail.messages);
  const assigneeInitials = detail.assignees.find((n) => n === assigned)?.[0] ?? assigned[0] ?? "?";

  return (
    <div className="fixed inset-0 z-[90] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="thread-detail-title">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close thread" onClick={onClose} />
      <div
        className="relative flex h-full w-[70vw] min-w-0 max-w-6xl flex-col border-l border-stone-200 bg-[#faf9f6] shadow-2xl"
      >
        <div className="flex shrink-0 flex-col gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h2 id="thread-detail-title" className="text-lg font-semibold leading-snug text-[var(--petrol,#1a4a4a)] sm:text-xl">
                {detail.subject}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Link
                  href={detail.companyCrmPath}
                  className="text-sm font-medium text-[#1a5c50] underline-offset-2 hover:underline"
                >
                  {detail.companyName}
                </Link>
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${prop.badgeClass}`}>
                  {prop.short}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-2 text-stone-500 hover:bg-stone-100"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <label className="flex items-center gap-2 text-xs text-stone-600">
              <span className="font-medium">Status</span>
              <select
                value={detailStatus}
                onChange={(e) => setDetailStatus(e.target.value as DetailThreadStatus)}
                className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-[var(--petrol,#1a4a4a)]"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => setStarred((s) => !s)}
              className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
              aria-pressed={starred}
            >
              {starred ? "★ Starred" : "☆ Star"}
            </button>

            <label className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
              <span className="font-medium">Assigned to</span>
              <span className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white py-1 pl-1 pr-2">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: "var(--petrol-mid, #1f5c5c)" }}
                >
                  {assigneeInitials}
                </span>
                <select
                  value={assigned}
                  onChange={(e) => setAssigned(e.target.value)}
                  className="border-0 bg-transparent text-xs font-medium text-[var(--petrol,#1a4a4a)] focus:ring-0"
                >
                  {detail.assignees.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <div className="space-y-6">
                {grouped.map((g) => (
                  <section key={g.label}>
                    <h3 className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-stone-400">
                      {g.label}
                    </h3>
                    <div className="space-y-3">
                      {g.items.map((msg) => (
                        <MessageCard
                          key={msg.id}
                          msg={msg}
                          expanded={expandedIds.has(msg.id)}
                          onToggle={() => toggleExpand(msg.id)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>

            <div className="shrink-0 border-t border-stone-200 bg-white px-4 py-3 sm:px-5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {(["reply", "reply_all", "forward"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setReplyMode(m)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      replyMode === m
                        ? "border-[#1a5c50] bg-[#1a5c50] text-white"
                        : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                    }`}
                  >
                    {m === "reply" ? "Reply" : m === "reply_all" ? "Reply all" : "Forward"}
                  </button>
                ))}
                <button
                  type="button"
                  className="text-xs font-medium text-[#1a5c50] hover:underline"
                  onClick={() => setShowCcBcc((s) => !s)}
                >
                  {showCcBcc ? "Hide CC/BCC" : "CC / BCC"}
                </button>
                <div className="relative">
                  <button
                    type="button"
                    className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                    onClick={() => setShowTemplatePick((s) => !s)}
                  >
                    Insert template
                  </button>
                  {showTemplatePick ? (
                    <ul className="absolute bottom-full left-0 z-10 mb-1 min-w-[200px] rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
                      {MOCK_EMAIL_TEMPLATES.map((t) => (
                        <li key={t.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-xs hover:bg-stone-50"
                            onClick={() => applyTemplate(t.id)}
                          >
                            {t.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>

              {showCcBcc ? (
                <div className="mb-2 grid gap-2 sm:grid-cols-2">
                  <input
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="CC"
                    className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs"
                  />
                  <input
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="BCC"
                    className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs"
                  />
                </div>
              ) : null}

              <EmailRichToolbar editorRef={replyRef} />
              <div
                ref={replyRef}
                contentEditable
                suppressContentEditableWarning
                className="min-h-[120px] rounded-b-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#1a5c50]/20"
              />

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className="vw-btn-primary text-sm" onClick={handleSendReply}>
                  Send
                </button>
                <button
                  type="button"
                  className="vw-btn-secondary text-sm"
                  onClick={() => console.log("[Email thread] attach (mock)")}
                >
                  Attach file
                </button>
              </div>
            </div>
          </div>

          <aside className="w-full shrink-0 border-t border-stone-200 bg-white lg:w-[240px] lg:border-l lg:border-t-0">
            <div className="max-h-[40vh] overflow-y-auto p-4 lg:max-h-none">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Company</h3>
              <div className="mt-2 rounded-lg border border-stone-200 bg-[#faf9f6] p-3 text-sm">
                <div className="font-semibold text-[var(--petrol,#1a4a4a)]">{detail.companyName}</div>
                <div className="mt-1 text-xs text-stone-600">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 font-medium ${prop.badgeClass}`}>
                    {prop.short}
                  </span>
                </div>
                <div className="mt-2 text-xs text-stone-700">
                  <div>{detail.sidebar.contactEmail}</div>
                  <div className="mt-1">{detail.sidebar.phone}</div>
                </div>
              </div>

              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-stone-500">Recent activity</h3>
              <ul className="mt-2 space-y-2 text-xs text-stone-700">
                {detail.sidebar.activities.map((a, i) => (
                  <li key={i} className="rounded-md border border-stone-100 bg-stone-50 px-2 py-1.5">
                    <div className="font-medium text-[var(--petrol,#1a4a4a)]">{a.title}</div>
                    <div className="text-stone-500">{a.at}</div>
                  </li>
                ))}
              </ul>

              {detail.sidebar.otherThreads.length > 0 ? (
                <>
                  <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-stone-500">Other threads</h3>
                  <ul className="mt-2 space-y-2">
                    {detail.sidebar.otherThreads.map((ot) => (
                      <li key={ot.id} className="rounded-md border border-stone-100 px-2 py-1.5 text-xs">
                        <div className="font-medium text-stone-800">{ot.subject}</div>
                        <div className="line-clamp-2 text-stone-500">{ot.preview}</div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-stone-500">Quick links</h3>
              <ul className="mt-2 flex flex-col gap-1 text-xs font-medium text-[#1a5c50]">
                <li>
                  <Link href={detail.companyCrmPath} className="hover:underline">
                    View in CRM
                  </Link>
                </li>
                <li>
                  <Link href="/tools/contract-tool" className="hover:underline">
                    Create offer
                  </Link>
                </li>
                <li>
                  <Link href="/tasks" className="hover:underline">
                    Create task
                  </Link>
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
