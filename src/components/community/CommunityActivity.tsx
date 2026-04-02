"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Hash, HelpCircle, Megaphone, MessageSquare } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/browser";

type ChannelRow = {
  id: string;
  name: string;
  channel_type: string | null;
  scope: string | null;
  property_id: string | null;
};

type MembershipRow = {
  channel_id: string;
  role: string | null;
  joined_at: string | null;
};

type MsgRow = { channel_id: string; created_at: string };

function channelIcon(channelType: string | null) {
  const t = (channelType ?? "").toLowerCase();
  if (t === "announcements") return Megaphone;
  if (t === "support") return HelpCircle;
  if (t === "social") return MessageSquare;
  return Hash;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (startMsg.getTime() === startToday.getTime()) return "Today";

  const diffMs = now.getTime() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "Yesterday";
  if (day < 7) return `${day} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

function formatJoined(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function CommunityActivity({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [msgRows, setMsgRows] = useState<MsgRow[]>([]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      const supabase = getSupabaseClient();

      const { data: memRows, error: memErr } = await supabase
        .from("chat_channel_members")
        .select("channel_id, role, joined_at")
        .eq("user_id", userId);

      if (memErr) {
        if (!cancelled) {
          setError(memErr.message);
          setLoading(false);
        }
        return;
      }

      const mems = (memRows ?? []) as MembershipRow[];
      if (cancelled) return;
      setMemberships(mems);

      const memberChannelIds = [...new Set(mems.map((m) => m.channel_id).filter(Boolean))];
      if (memberChannelIds.length === 0) {
        setChannels([]);
        setTotalMessages(0);
        setMsgRows([]);
        setLoading(false);
        return;
      }

      const { data: chRows, error: chErr } = await supabase
        .from("chat_channels")
        .select("id, name, channel_type, scope, property_id")
        .in("id", memberChannelIds);

      if (chErr) {
        if (!cancelled) {
          setError(chErr.message);
          setLoading(false);
        }
        return;
      }

      if (cancelled) return;
      setChannels((chRows ?? []) as ChannelRow[]);

      const { count, error: countErr } = await supabase
        .from("chat_messages")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_deleted", false);

      if (countErr) {
        if (!cancelled) {
          setError(countErr.message);
          setLoading(false);
        }
        return;
      }

      const { data: messages, error: msgErr } = await supabase
        .from("chat_messages")
        .select("channel_id, created_at")
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(8000);

      if (msgErr) {
        if (!cancelled) {
          setError(msgErr.message);
          setLoading(false);
        }
        return;
      }

      if (cancelled) return;
      setTotalMessages(count ?? 0);
      setMsgRows((messages ?? []) as MsgRow[]);
      setLoading(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const channelById = useMemo(() => {
    const m = new Map<string, ChannelRow>();
    for (const c of channels) m.set(c.id, c);
    return m;
  }, [channels]);

  const messageCountByChannel = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of msgRows) {
      counts.set(row.channel_id, (counts.get(row.channel_id) ?? 0) + 1);
    }
    return counts;
  }, [msgRows]);

  const stats = useMemo(() => {
    const counts = messageCountByChannel;
    const lastIso: string | null = msgRows[0]?.created_at ?? null;
    let mostActiveId: string | null = null;
    let mostActiveCount = 0;
    for (const [cid, n] of counts.entries()) {
      if (n > mostActiveCount) {
        mostActiveCount = n;
        mostActiveId = cid;
      }
    }
    const mostActiveName =
      mostActiveId && channelById.get(mostActiveId)
        ? `#${channelById.get(mostActiveId)!.name}`
        : "—";

    return {
      totalMessages,
      channelsJoined: memberships.length,
      mostActiveChannel: mostActiveName,
      lastActive: formatRelative(lastIso),
    };
  }, [msgRows, channelById, memberships.length, totalMessages, messageCountByChannel]);

  const rows = useMemo(() => {
    return memberships.map((m) => {
      const ch = channelById.get(m.channel_id);
      const msgCount = messageCountByChannel.get(m.channel_id) ?? 0;
      const Icon = channelIcon(ch?.channel_type ?? null);
      return { m, ch, msgCount, Icon };
    });
  }, [memberships, channelById, messageCountByChannel]);

  const card: CSSProperties = {
    backgroundColor: "#f9f9f6",
    borderRadius: 8,
    padding: 16,
    border: "1px solid #e5e5e0",
    flex: 1,
    minWidth: 120,
  };

  if (loading) {
    return (
      <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>Loading community activity…</p>
    );
  }

  if (error) {
    return (
      <p style={{ margin: 0, color: "#b91c1c", fontSize: 14 }}>{error}</p>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <MessageSquare size={22} color="#1a5c50" aria-hidden />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#1a2e2e" }}>Community Activity</h2>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 28,
        }}
      >
        <div style={card}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Messages sent</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "#1a2e2e" }}>{stats.totalMessages}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Channels joined</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "#1a2e2e" }}>{stats.channelsJoined}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Most active in</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2e2e", wordBreak: "break-word" }}>
            {stats.mostActiveChannel}
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Last active</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#1a2e2e" }}>{stats.lastActive}</div>
        </div>
      </div>

      <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600, color: "#1a2e2e" }}>Channels</h3>
      {rows.length === 0 ? (
        <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>You are not a member of any channels yet.</p>
      ) : (
        <div>
          {rows.map(({ m, ch, msgCount, Icon }) => (
            <div
              key={m.channel_id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                borderBottom: "1px solid #f0f0eb",
                paddingTop: 12,
                paddingBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <Icon size={18} color="#1a5c50" aria-hidden />
                <span style={{ fontWeight: 500, color: "#1a2e2e", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {ch?.name ?? m.channel_id}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "capitalize",
                    padding: "2px 8px",
                    borderRadius: 999,
                    backgroundColor: "#e8f0ee",
                    color: "#1a5c50",
                    flexShrink: 0,
                  }}
                >
                  {m.role ?? "member"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0, fontSize: 13, color: "#64748b" }}>
                <span>{msgCount} msg{msgCount === 1 ? "" : "s"}</span>
                <span style={{ whiteSpace: "nowrap" }}>Joined {formatJoined(m.joined_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
