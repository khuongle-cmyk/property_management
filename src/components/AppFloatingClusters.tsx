"use client";

import { useState } from "react";
import { Mail, MessageSquare, PenLine } from "lucide-react";
import FloatingActionMenu from "@/components/shared/FloatingActionMenu";
import AiAssistantWidget from "@/components/AiAssistantWidget";
import LeadChatbotWidget from "@/components/LeadChatbotWidget";
import VoiceAssistantWidget from "@/components/VoiceAssistantWidget";

const CONTACT_MAILTO =
  "mailto:hello@villageworks.com?subject=" + encodeURIComponent("VillageWorks inquiry");

/** Logged-in workspace shell: FAB + AI chat, email, voice/write. */
export function WorkspaceFloatingCluster() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  return (
    <>
      <FloatingActionMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        actions={[
          {
            id: "chat",
            label: "Chat",
            icon: MessageSquare,
            onClick: () => setAiOpen(true),
          },
          {
            id: "email",
            label: "Email",
            icon: Mail,
            onClick: () => {
              window.location.href = CONTACT_MAILTO;
            },
          },
          {
            id: "write",
            label: "Write",
            icon: PenLine,
            onClick: () => setVoiceOpen(true),
          },
        ]}
      />
      <AiAssistantWidget hideLauncher panelOpen={aiOpen} onPanelOpenChange={setAiOpen} />
      <VoiceAssistantWidget hideLauncher panelOpen={voiceOpen} onPanelOpenChange={setVoiceOpen} />
    </>
  );
}

/** Public marketing site: FAB + lead chatbot, email, voice/write. */
export function PublicSiteFloatingCluster() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  return (
    <>
      <FloatingActionMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        actions={[
          {
            id: "chat",
            label: "Chat",
            icon: MessageSquare,
            onClick: () => setLeadOpen(true),
          },
          {
            id: "email",
            label: "Email",
            icon: Mail,
            onClick: () => {
              window.location.href = CONTACT_MAILTO;
            },
          },
          {
            id: "write",
            label: "Write",
            icon: PenLine,
            onClick: () => setVoiceOpen(true),
          },
        ]}
      />
      <LeadChatbotWidget hideLauncher panelOpen={leadOpen} onPanelOpenChange={setLeadOpen} />
      <VoiceAssistantWidget hideLauncher panelOpen={voiceOpen} onPanelOpenChange={setVoiceOpen} />
    </>
  );
}
