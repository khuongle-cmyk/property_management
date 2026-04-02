"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Mail, Mic } from "lucide-react";
import FloatingActionMenu from "@/components/shared/FloatingActionMenu";
import AiAssistantWidget from "@/components/AiAssistantWidget";
import LeadChatbotWidget from "@/components/LeadChatbotWidget";
import VoiceAssistantWidget from "@/components/VoiceAssistantWidget";
import { getSupabaseClient } from "@/lib/supabase/browser";

const CONTACT_MAILTO =
  "mailto:hello@villageworks.com?subject=" + encodeURIComponent("VillageWorks inquiry");

/** Sub-actions from bottom to top: AI Assistant → Email → Voice */
const FAB_ACTION_ORDER = ["ai-assistant", "email", "voice"] as const;

/** Logged-in workspace: FAB opens AI assistant, email compose, and voice assistant (no standalone launchers). */
export function WorkspaceFloatingCluster() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!cancelled) {
        setLoggedIn(Boolean(user));
        setAuthReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  if (!authReady) return null;
  if (!loggedIn) {
    return <PublicSiteFloatingCluster />;
  }

  const actionsById = {
    "ai-assistant": {
      id: "ai-assistant",
      label: "AI Assistant",
      icon: Bot,
      onClick: () => setAiOpen(true),
    },
    email: {
      id: "email",
      label: "Email",
      icon: Mail,
      onClick: () => {
        router.push("/email?compose=1");
      },
    },
    voice: {
      id: "voice",
      label: "Voice",
      icon: Mic,
      onClick: () => setVoiceOpen(true),
    },
  } as const;

  return (
    <>
      <FloatingActionMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        actions={FAB_ACTION_ORDER.map((key) => actionsById[key])}
      />
      <AiAssistantWidget hideLauncher panelOpen={aiOpen} onPanelOpenChange={setAiOpen} />
      <VoiceAssistantWidget hideLauncher panelOpen={voiceOpen} onPanelOpenChange={setVoiceOpen} />
    </>
  );
}

/** Public marketing site: lead flow, mailto, and voice assistant */
export function PublicSiteFloatingCluster() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const actionsById = {
    "ai-assistant": {
      id: "ai-assistant",
      label: "AI Assistant",
      icon: Bot,
      onClick: () => setLeadOpen(true),
    },
    email: {
      id: "email",
      label: "Email",
      icon: Mail,
      onClick: () => {
        window.location.href = CONTACT_MAILTO;
      },
    },
    voice: {
      id: "voice",
      label: "Voice",
      icon: Mic,
      onClick: () => setVoiceOpen(true),
    },
  } as const;

  return (
    <>
      <FloatingActionMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        actions={FAB_ACTION_ORDER.map((key) => actionsById[key])}
      />
      <LeadChatbotWidget hideLauncher panelOpen={leadOpen} onPanelOpenChange={setLeadOpen} />
      <VoiceAssistantWidget hideLauncher panelOpen={voiceOpen} onPanelOpenChange={setVoiceOpen} />
    </>
  );
}
