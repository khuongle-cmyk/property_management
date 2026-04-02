"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import ChannelSidebar from "@/components/community/ChannelSidebar";
import ChatWindow from "@/components/community/ChatWindow";
import { ChatChannel } from "@/types/chat";

const PETROL = "#0D4F4F";

export default function PortalCommunityPage() {
  const [activeChannel, setActiveChannel] = useState<ChatChannel | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const supabase = createClient();

  useEffect(() => {
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);
    };
    void getUser();
  }, [supabase]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "auto 1fr",
        gap: 16,
        height: "min(calc(100dvh - 120px), 900px)",
        minHeight: 420,
      }}
    >
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: PETROL }}>Community chat</h1>
      <div
        style={{
          display: "flex",
          minHeight: 0,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          overflow: "hidden",
          background: "#fff",
        }}
      >
        {currentUserId ? (
          <ChannelSidebar
            activeChannelId={activeChannel?.id || null}
            onSelectChannel={setActiveChannel}
            currentUserId={currentUserId}
          />
        ) : (
          <div style={{ width: 256, flexShrink: 0, borderRight: "1px solid #e5e7eb", background: "#f9fafb" }} aria-hidden />
        )}
        <ChatWindow channel={activeChannel} currentUserId={currentUserId} />
      </div>
    </div>
  );
}
