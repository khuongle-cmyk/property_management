"use client";

import { useState, useEffect } from "react";
import ChannelSidebar from "@/components/community/ChannelSidebar";
import ChatWindow from "@/components/community/ChatWindow";
import { createClient } from "@/lib/supabase/client";
import { ChatChannel } from "@/types/chat";

export default function CommunityPage() {
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
    <div className="flex h-[calc(100vh-64px)]">
      {currentUserId ? (
        <ChannelSidebar
          activeChannelId={activeChannel?.id || null}
          onSelectChannel={setActiveChannel}
          currentUserId={currentUserId}
        />
      ) : (
        <div className="w-64 shrink-0 border-r border-gray-200 bg-gray-50" aria-hidden />
      )}
      <ChatWindow channel={activeChannel} currentUserId={currentUserId} />
    </div>
  );
}
