"use client";

import { useState, useEffect } from "react";
import { Hash, Megaphone, HelpCircle, Coffee, Globe, Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ChatChannel } from "@/types/chat";

interface ChannelSidebarProps {
  activeChannelId: string | null;
  onSelectChannel: (channel: ChatChannel) => void;
  propertyId?: string;
}

const channelIcons: Record<string, typeof Hash> = {
  general: Hash,
  announcements: Megaphone,
  support: HelpCircle,
  social: Coffee,
};

export default function ChannelSidebar({
  activeChannelId,
  onSelectChannel,
  propertyId,
}: ChannelSidebarProps) {
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [unreadCounts] = useState<Record<string, number>>({});
  const supabase = createClient();

  useEffect(() => {
    const fetchChannels = async () => {
      const { data } = await supabase
        .from("chat_channels")
        .select("*")
        .eq("is_archived", false)
        .order("channel_type", { ascending: true })
        .order("name", { ascending: true });

      if (data) setChannels(data as ChatChannel[]);
    };
    void fetchChannels();
  }, [propertyId, supabase]);

  const propertyChannels = channels.filter(
    (c) => c.scope === "property" && (!propertyId || c.property_id === propertyId),
  );
  const crossPropertyChannels = channels.filter((c) => c.scope === "cross_property");

  return (
    <div className="flex h-full w-64 flex-col border-r border-gray-200 bg-gray-50">
      <div className="border-b border-gray-200 p-4">
        <h2 className="text-lg font-semibold text-gray-900">Community</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {propertyChannels.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-1 px-2 py-1 text-xs font-medium uppercase text-gray-500">
              <Building2 size={12} />
              Property
            </div>
            {propertyChannels.map((channel) => {
              const Icon = channelIcons[channel.channel_type] || Hash;
              const unread = unreadCounts[channel.id] || 0;
              return (
                <button
                  key={channel.id}
                  onClick={() => onSelectChannel(channel)}
                  className={`w-full rounded-md px-2 py-1.5 text-sm transition-colors ${
                    activeChannelId === channel.id
                      ? "bg-blue-100 font-medium text-blue-900"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon size={16} className="shrink-0" />
                    <span className="truncate">{channel.name}</span>
                    {unread > 0 ? (
                      <span className="ml-auto min-w-[20px] rounded-full bg-blue-600 px-1.5 py-0.5 text-center text-xs text-white">
                        {unread}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {crossPropertyChannels.length > 0 && (
          <div>
            <div className="flex items-center gap-1 px-2 py-1 text-xs font-medium uppercase text-gray-500">
              <Globe size={12} />
              All Properties
            </div>
            {crossPropertyChannels.map((channel) => {
              const Icon = channelIcons[channel.channel_type] || Hash;
              return (
                <button
                  key={channel.id}
                  onClick={() => onSelectChannel(channel)}
                  className={`w-full rounded-md px-2 py-1.5 text-sm transition-colors ${
                    activeChannelId === channel.id
                      ? "bg-blue-100 font-medium text-blue-900"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon size={16} className="shrink-0" />
                    <span className="truncate">{channel.name}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
