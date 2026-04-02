"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Hash,
  Megaphone,
  HelpCircle,
  Coffee,
  Globe,
  Building2,
  PenSquare,
  MessageCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ChatChannel } from "@/types/chat";
import { getOrCreateDMChannel } from "@/lib/community/get-or-create-dm-channel";
import { profileToDisplayName } from "@/lib/community/display-name";
import { getUserAvatarColor } from "@/lib/community/user-avatar-color";

interface ChannelSidebarProps {
  activeChannelId: string | null;
  onSelectChannel: (channel: ChatChannel) => void;
  currentUserId: string;
  propertyId?: string;
}

const channelIcons: Record<string, typeof Hash> = {
  general: Hash,
  announcements: Megaphone,
  support: HelpCircle,
  social: Coffee,
};

type ProfileRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
};

type DmRowInfo = {
  name: string;
  initials: string;
  color: string;
  unread: boolean;
};

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function ChannelSidebar({
  activeChannelId,
  onSelectChannel,
  currentUserId,
  propertyId,
}: ChannelSidebarProps) {
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [dmMeta, setDmMeta] = useState<Record<string, DmRowInfo>>({});
  const [newMsgOpen, setNewMsgOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [searchResults, setSearchResults] = useState<ProfileRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [dmBusy, setDmBusy] = useState(false);
  const supabase = createClient();

  const loadChannels = useCallback(async () => {
    const { data } = await supabase
      .from("chat_channels")
      .select("*")
      .eq("is_archived", false)
      .order("channel_type", { ascending: true })
      .order("name", { ascending: true });

    if (data) setChannels(data as ChatChannel[]);
  }, [supabase]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels, propertyId]);

  const directChannels = useMemo(
    () => channels.filter((c) => c.scope === "direct" && c.channel_type === "direct"),
    [channels],
  );

  useEffect(() => {
    if (!currentUserId || directChannels.length === 0) {
      setDmMeta({});
      return;
    }
    let cancelled = false;
    const run = async () => {
      const dmIds = directChannels.map((c) => c.id);
      const { data: members } = await supabase
        .from("chat_channel_members")
        .select("channel_id, user_id")
        .in("channel_id", dmIds);

      if (cancelled) return;

      const otherByChannel = new Map<string, string>();
      for (const row of members ?? []) {
        const uid = row.user_id as string;
        const cid = row.channel_id as string;
        if (uid === currentUserId) continue;
        otherByChannel.set(cid, uid);
      }

      const otherIds = [...new Set(otherByChannel.values())];
      if (otherIds.length === 0) {
        setDmMeta({});
        return;
      }

      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("user_id, first_name, last_name, display_name")
        .in("user_id", otherIds);

      if (cancelled) return;

      const profileByUser = new Map<string, ProfileRow>();
      for (const p of profiles ?? []) {
        profileByUser.set(p.user_id as string, p as ProfileRow);
      }

      const { data: reads } = await supabase
        .from("chat_read_status")
        .select("channel_id, last_read_at")
        .eq("user_id", currentUserId)
        .in("channel_id", dmIds);

      const readMap = new Map<string, string>();
      for (const r of reads ?? []) {
        readMap.set(r.channel_id as string, r.last_read_at as string);
      }

      const { data: recentMsgs } = await supabase
        .from("chat_messages")
        .select("channel_id, created_at, user_id")
        .in("channel_id", dmIds)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(800);

      const latestByChannel = new Map<string, { created_at: string; user_id: string | null }>();
      for (const msg of recentMsgs ?? []) {
        const cid = msg.channel_id as string;
        if (!latestByChannel.has(cid)) {
          latestByChannel.set(cid, {
            created_at: msg.created_at as string,
            user_id: (msg.user_id as string | null) ?? null,
          });
        }
      }

      const next: Record<string, DmRowInfo> = {};
      for (const ch of directChannels) {
        const otherId = otherByChannel.get(ch.id);
        if (!otherId) continue;
        const prof = profileByUser.get(otherId);
        const { name, initials } = profileToDisplayName(prof);
        const color = getUserAvatarColor(otherId);
        const latest = latestByChannel.get(ch.id);
        const readAt = readMap.get(ch.id);
        let unread = false;
        if (latest?.user_id && latest.user_id !== currentUserId) {
          const tMsg = new Date(latest.created_at).getTime();
          const tRead = readAt ? new Date(readAt).getTime() : 0;
          unread = tMsg > tRead;
        }
        next[ch.id] = { name, initials, color, unread };
      }
      if (!cancelled) setDmMeta(next);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [supabase, currentUserId, directChannels]);

  useEffect(() => {
    if (!newMsgOpen || debouncedSearch.trim().length < 1) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const q = debouncedSearch.trim();
    const run = async () => {
      setSearchLoading(true);
      const pattern = `%${q}%`;
      const qp = () =>
        supabase.from("user_profiles").select("user_id, first_name, last_name, display_name").neq("user_id", currentUserId);
      const [fn, ln, dn] = await Promise.all([
        qp().ilike("first_name", pattern).limit(10),
        qp().ilike("last_name", pattern).limit(10),
        qp().ilike("display_name", pattern).limit(10),
      ]);
      const merged = new Map<string, ProfileRow>();
      for (const row of [...(fn.data ?? []), ...(ln.data ?? []), ...(dn.data ?? [])]) {
        merged.set(row.user_id as string, row as ProfileRow);
      }
      if (!cancelled) {
        setSearchLoading(false);
        setSearchResults([...merged.values()].slice(0, 10));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, newMsgOpen, supabase, currentUserId]);

  const propertyChannels = channels.filter(
    (c) =>
      c.scope === "property" &&
      c.channel_type !== "direct" &&
      (!propertyId || c.property_id === propertyId),
  );
  const crossPropertyChannels = channels.filter((c) => c.scope === "cross_property");

  async function startDmWithUser(otherUserId: string) {
    if (!currentUserId || dmBusy) return;
    setDmBusy(true);
    const { channelId, error } = await getOrCreateDMChannel(supabase, otherUserId, currentUserId);
    if (error || !channelId) {
      console.error(error);
      alert(error ?? "Could not open conversation.");
      setDmBusy(false);
      return;
    }
    const { data: ch } = await supabase.from("chat_channels").select("*").eq("id", channelId).single();
    setDmBusy(false);
    setNewMsgOpen(false);
    setSearch("");
    setSearchResults([]);
    await loadChannels();
    if (ch) onSelectChannel(ch as ChatChannel);
  }

  return (
    <div className="relative flex h-full w-64 flex-col border-r border-gray-200 bg-gray-50">
      <div className="border-b border-gray-200 p-3">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Community</h2>
        <button
          type="button"
          onClick={() => setNewMsgOpen(true)}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: "#1a5c50" }}
        >
          <PenSquare size={18} aria-hidden />
          New message
        </button>
      </div>

      {newMsgOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-24"
          role="dialog"
          aria-modal="true"
          aria-label="New message"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setNewMsgOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold text-gray-900">New message</span>
              <button
                type="button"
                className="text-sm text-gray-500 hover:text-gray-800"
                onClick={() => setNewMsgOpen(false)}
              >
                Close
              </button>
            </div>
            <input
              type="search"
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              autoFocus
            />
            <div className="max-h-64 overflow-y-auto">
              {searchLoading ? (
                <p className="text-sm text-gray-500">Searching…</p>
              ) : search.trim().length < 1 ? (
                <p className="text-sm text-gray-500">Type to search colleagues.</p>
              ) : searchResults.length === 0 ? (
                <p className="text-sm text-gray-500">No users found.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {searchResults.map((row) => {
                    const { name, initials } = profileToDisplayName(row);
                    const bg = getUserAvatarColor(row.user_id);
                    return (
                      <li key={row.user_id}>
                        <button
                          type="button"
                          disabled={dmBusy}
                          className="flex w-full items-center gap-3 py-2 text-left hover:bg-gray-50 disabled:opacity-50"
                          onClick={() => void startDmWithUser(row.user_id)}
                        >
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                            style={{ backgroundColor: bg }}
                          >
                            {initials}
                          </span>
                          <span className="truncate text-sm font-medium text-gray-900">{name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto p-2">
        {propertyChannels.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-1 px-2 py-1 text-xs font-medium uppercase text-gray-500">
              <Building2 size={12} />
              Property
            </div>
            {propertyChannels.map((channel) => {
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

        {crossPropertyChannels.length > 0 && (
          <div className="mb-4">
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

        {directChannels.length > 0 && (
          <div>
            <div className="flex items-center gap-1 px-2 py-1 text-xs font-medium uppercase text-gray-500">
              <MessageCircle size={12} />
              Direct messages
            </div>
            {directChannels.map((channel) => {
              const meta = dmMeta[channel.id];
              const label = meta?.name ?? "Direct message";
              const initials = meta?.initials ?? "?";
              const bg = meta?.color ?? "#1a5c50";
              const unread = meta?.unread ?? false;
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
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ backgroundColor: bg }}
                    >
                      {initials}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                    {unread ? (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" aria-label="Unread" />
                    ) : null}
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
