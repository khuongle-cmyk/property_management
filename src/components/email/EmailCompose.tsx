"use client";

import { useEffect, useRef, useState } from "react";
import {
  MOCK_CONTACTS,
  MOCK_EMAIL_TEMPLATES,
  VW_PROPERTIES,
  type VwPropertyId,
} from "@/lib/email/mock-dashboard-data";
import EmailRichToolbar from "@/components/email/EmailRichToolbar";
import { EMAIL_TEMPLATE_HTML } from "@/components/email/email-rich-shared";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function EmailCompose({ open, onClose }: Props) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [propertyId, setPropertyId] = useState<VwPropertyId>("erottaja2");
  const [templateId, setTemplateId] = useState("blank");
  const [contactOpen, setContactOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const filteredContacts = MOCK_CONTACTS.filter(
    (c) =>
      !to.trim() ||
      c.name.toLowerCase().includes(to.toLowerCase()) ||
      c.email.toLowerCase().includes(to.toLowerCase()),
  ).slice(0, 6);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const getHtml = () => editorRef.current?.innerHTML ?? "";

  const buildPayload = (draft: boolean) => ({
    draft,
    to,
    cc: showCcBcc ? cc : undefined,
    bcc: showCcBcc ? bcc : undefined,
    subject,
    propertyId,
    templateId,
    bodyHtml: getHtml(),
  });

  function handleSend() {
    console.log("[Email compose] send", buildPayload(false));
    onClose();
  }

  function handleSaveDraft() {
    console.log("[Email compose] save draft", buildPayload(true));
    onClose();
  }

  useEffect(() => {
    if (!open || !editorRef.current) return;
    editorRef.current.innerHTML = EMAIL_TEMPLATE_HTML[templateId] ?? "<p></p>";
  }, [open, templateId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="email-compose-title">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 transition-opacity"
        aria-label="Close compose"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="relative flex h-full w-full max-w-lg flex-col border-l border-stone-200 bg-[#faf9f6] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3">
          <h2 id="email-compose-title" className="text-lg font-semibold text-[var(--petrol,#1a4a4a)]">
            New message
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-[var(--petrol,#1a4a4a)]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            <div className="relative">
              <label className="block text-xs font-medium text-stone-600">To</label>
              <input
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setContactOpen(true);
                }}
                onFocus={() => setContactOpen(true)}
                className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-[var(--petrol,#1a4a4a)] focus:border-[#1a5c50] focus:outline-none focus:ring-2 focus:ring-[#1a5c50]/20"
                placeholder="name@company.fi"
                autoComplete="off"
              />
              {contactOpen && filteredContacts.length > 0 ? (
                <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
                  {filteredContacts.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-[#faf9f6]"
                        onClick={() => {
                          setTo(c.email);
                          setContactOpen(false);
                        }}
                      >
                        <span className="font-medium text-[var(--petrol,#1a4a4a)]">{c.name}</span>
                        <span className="block text-xs text-stone-500">{c.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <button
              type="button"
              className="text-xs font-medium text-[#1a5c50] hover:underline"
              onClick={() => setShowCcBcc((s) => !s)}
            >
              {showCcBcc ? "Hide CC / BCC" : "CC / BCC"}
            </button>

            {showCcBcc ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-stone-600">CC</label>
                  <input
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600">BCC</label>
                  <input
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
                  />
                </div>
              </>
            ) : null}

            <div>
              <label className="block text-xs font-medium text-stone-600">Subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-[var(--petrol,#1a4a4a)] focus:border-[#1a5c50] focus:outline-none focus:ring-2 focus:ring-[#1a5c50]/20"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-stone-600">Template</label>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
                >
                  {MOCK_EMAIL_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600">Property</label>
                <select
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value as VwPropertyId)}
                  className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
                >
                  {VW_PROPERTIES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.short} — {p.legalName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <EmailRichToolbar editorRef={editorRef} />
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                className="min-h-[220px] rounded-b-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#1a5c50]/20"
                onClick={() => editorRef.current?.focus()}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-stone-200 bg-white px-4 py-3">
          <button type="button" className="vw-btn-primary px-5" onClick={handleSend}>
            Send
          </button>
          <button type="button" className="vw-btn-secondary" onClick={handleSaveDraft}>
            Save draft
          </button>
          <button type="button" className="ml-auto text-sm text-stone-600 hover:text-[var(--petrol,#1a4a4a)]" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
