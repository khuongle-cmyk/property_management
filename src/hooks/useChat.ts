"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { ChatMessage } from "@/types/chat";

export function useChat(channelId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!channelId) return;

    const fetchMessages = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("channel_id", channelId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true })
        .limit(100);

      if (!error && data) {
        setMessages(data as ChatMessage[]);
      }
      setLoading(false);
    };

    void fetchMessages();
  }, [channelId, supabase]);

  useEffect(() => {
    if (!channelId) return;

    const channel = supabase
      .channel(`chat:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        async (payload) => {
          if ((payload.new as { is_deleted?: boolean }).is_deleted) return;
          const { data } = await supabase
            .from("chat_messages")
            .select("*")
            .eq("id", payload.new.id)
            .single();
          if (data && !(data as ChatMessage).is_deleted) {
            setMessages((prev) => [...prev, data as ChatMessage]);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === payload.new.id ? { ...msg, ...(payload.new as Record<string, unknown>) } as ChatMessage : msg,
            ),
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelId, supabase]);

  const sendMessage = useCallback(
    async (content: string, userId: string) => {
      if (!channelId || !content.trim()) return null;

      const { data, error } = await supabase
        .from("chat_messages")
        .insert({
          channel_id: channelId,
          user_id: userId,
          content: content.trim(),
        })
        .select()
        .single();

      if (error) {
        console.error("Failed to send message:", error);
        return null;
      }

      if (content.includes("@AI") || content.includes("@ai")) {
        await triggerAIResponse(channelId, content, data.id);
      }

      return data;
    },
    [channelId, supabase],
  );

  const triggerAIResponse = async (
    channel_id: string,
    user_message: string,
    parent_message_id: string,
  ) => {
    try {
      const response = await fetch("/api/chat/ai-respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id,
          user_message,
          parent_message_id,
        }),
      });
      if (!response.ok) console.error("AI response failed");
    } catch (error) {
      console.error("AI trigger error:", error);
    }
  };

  const markAsRead = useCallback(
    async (userId: string) => {
      if (!channelId) return;
      await supabase.from("chat_read_status").upsert(
        {
          channel_id: channelId,
          user_id: userId,
          last_read_at: new Date().toISOString(),
        },
        { onConflict: "channel_id,user_id" },
      );
    },
    [channelId, supabase],
  );

  const editMessage = useCallback(
    async (messageId: string, newContent: string) => {
      if (!newContent.trim()) return;
      const { error } = await supabase
        .from("chat_messages")
        .update({
          content: newContent.trim(),
          is_edited: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", messageId);
      if (error) console.error("Failed to edit message:", error);
    },
    [supabase],
  );

  const deleteMessage = useCallback(async (messageId: string) => {
    const { error } = await supabase
      .from("chat_messages")
      .update({
        is_deleted: true,
        content: "",
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId);
    if (error) console.error("Failed to delete message:", error);
  }, [supabase]);

  return { messages, loading, sendMessage, editMessage, deleteMessage, markAsRead, messagesEndRef };
}
