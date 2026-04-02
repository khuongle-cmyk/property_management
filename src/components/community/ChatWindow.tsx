"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Send, Bot, Pencil, Trash2, MoreHorizontal } from "lucide-react";
import { useChat } from "@/hooks/useChat";
import { ChatChannel } from "@/types/chat";
import { createClient } from "@/lib/supabase/client";
import { profileToDisplayName, type ShortProfile } from "@/lib/community/display-name";
import { getUserAvatarColor } from "@/lib/community/user-avatar-color";
import ConfirmModal from "@/components/shared/ConfirmModal";

interface ChatWindowProps {
  channel: ChatChannel | null;
  currentUserId: string;
}

type UserDisplay = { name: string; initials: string };

const BUBBLE_COLORS = [
  { bg: "#DCF8C6", text: "#1B5E20", avatar: "#4CAF50" },
  { bg: "#FFE0B2", text: "#E65100", avatar: "#FF9800" },
  { bg: "#BBDEFB", text: "#0D47A1", avatar: "#2196F3" },
  { bg: "#E1BEE7", text: "#6A1B9A", avatar: "#9C27B0" },
  { bg: "#B2DFDB", text: "#004D40", avatar: "#009688" },
  { bg: "#F8BBD0", text: "#880E4F", avatar: "#E91E63" },
  { bg: "#FFF9C4", text: "#F57F17", avatar: "#FFC107" },
  { bg: "#D1C4E9", text: "#311B92", avatar: "#673AB7" },
];

function getUserColor(userId: string) {
  const hash = userId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const i = hash % BUBBLE_COLORS.length;
  return BUBBLE_COLORS[i] as (typeof BUBBLE_COLORS)[number];
}

export default function ChatWindow({ channel, currentUserId }: ChatWindowProps) {
  const { messages, loading, sendMessage, editMessage, deleteMessage, markAsRead } = useChat(
    channel?.id || null,
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [userNames, setUserNames] = useState<Record<string, UserDisplay>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [dmPeer, setDmPeer] = useState<{ userId: string; name: string; initials: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const visibleMessages = messages.filter((m) => !m.is_deleted);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (channel?.id && currentUserId) {
      void markAsRead(currentUserId);
    }
  }, [channel?.id, messages.length, currentUserId, markAsRead]);

  useEffect(() => {
    if (editingMessageId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingMessageId]);

  useEffect(() => {
    setOpenMenuId(null);
  }, [editingMessageId]);

  useEffect(() => {
    if (openMenuId === null) return;
    const onMouseDown = (e: MouseEvent) => {
      const root = document.querySelector(
        `[data-chat-menu-root="${CSS.escape(openMenuId)}"]`,
      );
      if (root?.contains(e.target as Node)) return;
      setOpenMenuId(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [openMenuId]);

  useEffect(() => {
    if (!channel || channel.scope !== "direct") {
      setDmPeer(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      const supabase = createClient();
      const { data: members } = await supabase
        .from("chat_channel_members")
        .select("user_id")
        .eq("channel_id", channel.id);
      if (cancelled) return;
      const otherId = (members ?? []).map((m) => m.user_id as string).find((id) => id !== currentUserId);
      if (!otherId) {
        setDmPeer(null);
        return;
      }
      const { data: prof } = await supabase
        .from("user_profiles")
        .select("user_id, first_name, last_name, display_name")
        .eq("user_id", otherId)
        .maybeSingle();
      if (cancelled) return;
      const { name, initials } = profileToDisplayName(prof);
      setDmPeer({ userId: otherId, name, initials });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [channel, currentUserId]);

  useEffect(() => {
    if (loading || !channel) return;

    const uniqueUserIds = [
      ...new Set(
        messages
          .filter((m) => !m.is_deleted)
          .map((m) => m.user_id)
          .filter(Boolean),
      ),
    ] as string[];

    if (uniqueUserIds.length === 0) {
      setUserNames({});
      return;
    }

    const run = async () => {
      const supabase = createClient();
      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("user_id, first_name, last_name")
        .in("user_id", uniqueUserIds);

      const next: Record<string, UserDisplay> = {};
      const fallback: UserDisplay = { name: "Member", initials: "M" };
      for (const id of uniqueUserIds) {
        next[id] = fallback;
      }
      for (const row of profiles ?? []) {
        const uid = row.user_id as string;
        if (!uid) continue;
        next[uid] = profileToDisplayName(row as ShortProfile);
      }
      setUserNames(next);
    };

    void run();
  }, [messages, loading, channel]);

  async function commitEdit(messageId: string) {
    if (!editContent.trim()) return;
    await editMessage(messageId, editContent);
    setEditingMessageId(null);
  }

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    await sendMessage(input, currentUserId);
    setInput("");
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (!channel) {
    return <div className="flex flex-1 items-center justify-center text-gray-400">Select a channel to start chatting</div>;
  }

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" });

  const avatarBaseStyle: CSSProperties = {
    display: "flex",
    height: 32,
    width: 32,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9999,
    fontSize: 10,
    fontWeight: 600,
  };

  const isDirect = channel.scope === "direct";
  const dmHeaderBg = dmPeer ? getUserAvatarColor(dmPeer.userId) : "#1a5c50";

  return (
    <div className="flex h-full flex-1 flex-col">
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        {isDirect ? (
          dmPeer ? (
            <div className="flex items-start gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: dmHeaderBg }}
              >
                {dmPeer.initials}
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{dmPeer.name}</h3>
                <p className="text-sm text-gray-500">Direct message</p>
              </div>
            </div>
          ) : (
            <div>
              <h3 className="font-semibold text-gray-900">Direct message</h3>
              <p className="text-sm text-gray-500">Loading…</p>
            </div>
          )
        ) : (
          <>
            <h3 className="font-semibold text-gray-900">#{channel.name}</h3>
            {channel.description ? <p className="text-sm text-gray-500">{channel.description}</p> : null}
          </>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-2">
        {loading ? (
          <div className="py-8 text-center text-gray-400">Loading messages...</div>
        ) : visibleMessages.length === 0 ? (
          <div className="py-8 text-center text-gray-400">No messages yet. Start the conversation!</div>
        ) : (
          visibleMessages.map((msg) => {
            const isOwn = msg.user_id === currentUserId;
            const isAI = msg.is_ai_response;
            const isSystem = msg.is_system_message;
            const canEditOwn = isOwn && !isAI && !isSystem;
            const isEditing = editingMessageId === msg.id;
            const userName = isAI
              ? "VillageWorks AI"
              : isSystem
                ? "System"
                : msg.user_id
                  ? (userNames[msg.user_id]?.name ?? "Member")
                  : "Unknown";

            const otherPalette =
              !isOwn && !isAI && !isSystem && msg.user_id ? getUserColor(msg.user_id) : null;

            const bubbleStyle: CSSProperties = isOwn
              ? { backgroundColor: "#1a5c50", color: "#ffffff" }
              : isAI
                ? {
                    backgroundColor: "#F3E8FF",
                    color: "#6A1B9A",
                    border: "1px solid #E1BEE7",
                  }
                : otherPalette
                  ? { backgroundColor: otherPalette.bg, color: otherPalette.text }
                  : { backgroundColor: "#EEEEEE", color: "#424242" };

            let avatarStyle: CSSProperties = { ...avatarBaseStyle };
            let avatarContent: React.ReactNode;

            if (isAI) {
              avatarStyle = { ...avatarStyle, backgroundColor: "#9C27B0", color: "#ffffff" };
              avatarContent = <Bot size={16} strokeWidth={2} />;
            } else if (isOwn) {
              avatarStyle = { ...avatarStyle, backgroundColor: "#1a5c50", color: "#ffffff" };
              avatarContent = userNames[currentUserId]?.initials ?? "M";
            } else if (isSystem) {
              avatarStyle = { ...avatarStyle, backgroundColor: "#607D8B", color: "#ffffff" };
              avatarContent = "S";
            } else if (msg.user_id && otherPalette) {
              avatarStyle = { ...avatarStyle, backgroundColor: otherPalette.avatar, color: "#ffffff" };
              avatarContent = userNames[msg.user_id]?.initials ?? "M";
            } else {
              avatarStyle = { ...avatarStyle, backgroundColor: "#9E9E9E", color: "#ffffff" };
              avatarContent = "M";
            }

            return (
              <div key={msg.id} className={`flex gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
                <div style={avatarStyle}>{avatarContent}</div>
                <div className={`max-w-[70%] ${isOwn ? "text-right" : ""}`}>
                  <div
                    className={`mb-0.5 flex flex-wrap items-baseline gap-2 ${isOwn ? "justify-end" : ""}`}
                  >
                    <span
                      className={`text-xs font-medium ${isAI ? "text-purple-600" : "text-gray-700"}`}
                    >
                      {userName}
                    </span>
                    {canEditOwn ? (
                      <span className="inline-flex items-center gap-0.5">
                        <span className="text-xs text-gray-400">{formatTime(msg.created_at)}</span>
                        <div
                          className="relative inline-flex items-center"
                          data-chat-menu-root={msg.id}
                        >
                          <button
                            type="button"
                            className="cursor-pointer rounded p-1 text-gray-300 hover:text-gray-500"
                            aria-label="Message actions"
                            aria-expanded={openMenuId === msg.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId((id) => (id === msg.id ? null : msg.id));
                            }}
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          {openMenuId === msg.id ? (
                            <div
                              className="absolute right-0 top-full z-20 mt-1 min-w-[120px] rounded-md border bg-white py-1 shadow-lg"
                              style={{ borderColor: "#e5e5e0" }}
                              role="menu"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                onClick={() => {
                                  setEditingMessageId(msg.id);
                                  setEditContent(msg.content);
                                  setOpenMenuId(null);
                                }}
                              >
                                <Pencil size={14} />
                                Edit
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                onClick={() => {
                                  setDeleteConfirm(msg.id);
                                  setOpenMenuId(null);
                                }}
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">{formatTime(msg.created_at)}</span>
                    )}
                    {msg.is_edited ? (
                      <span className="text-xs text-gray-400">(edited)</span>
                    ) : null}
                  </div>
                  {canEditOwn && isEditing ? (
                    <div
                      className={`flex flex-col gap-2 ${isOwn ? "items-end" : "items-start"}`}
                    >
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void commitEdit(msg.id);
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setEditingMessageId(null);
                          }
                        }}
                        className="w-full min-w-[12rem] max-w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#1a5c50]"
                        style={isOwn ? { backgroundColor: "#fff", color: "#111" } : undefined}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!editContent.trim()}
                          onClick={() => void commitEdit(msg.id)}
                          className="rounded px-3 py-1 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                          style={{ backgroundColor: "#1a5c50" }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingMessageId(null)}
                          className="rounded bg-gray-100 px-3 py-1 text-sm font-medium text-gray-800"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={`inline-block max-w-full ${isOwn ? "ml-auto" : ""}`}>
                      <div
                        className="inline-block rounded-lg px-3 py-2 text-sm"
                        style={bubbleStyle}
                      >
                        {msg.content}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isDirect
                ? `${dmPeer ? `Message ${dmPeer.name}` : "Message"}… (type @AI to ask the assistant)`
                : `Message #${channel.name}… (type @AI to ask the assistant)`
            }
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={sending}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending}
            className="rounded-lg bg-blue-600 px-3 py-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Type <span className="rounded bg-gray-100 px-1 font-mono">@AI</span> to ask the VillageWorks assistant
        </p>
      </div>

      <ConfirmModal
        isOpen={!!deleteConfirm}
        title="Delete message"
        message="Are you sure you want to delete this message? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (!deleteConfirm) return;
          void deleteMessage(deleteConfirm);
          setDeleteConfirm(null);
          if (editingMessageId === deleteConfirm) setEditingMessageId(null);
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
