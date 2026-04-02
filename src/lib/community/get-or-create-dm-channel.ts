import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Finds an existing 1:1 direct channel with both users, or creates one.
 * Requires DB: chat_channels.scope = 'direct', channel_type = 'direct'.
 */
export async function getOrCreateDMChannel(
  supabase: SupabaseClient,
  otherUserId: string,
  currentUserId: string,
): Promise<{ channelId: string | null; error: string | null }> {
  if (otherUserId === currentUserId) {
    return { channelId: null, error: "Cannot open a DM with yourself." };
  }

  const { data: myRows, error: myErr } = await supabase
    .from("chat_channel_members")
    .select("channel_id")
    .eq("user_id", currentUserId);

  if (myErr) {
    return { channelId: null, error: myErr.message };
  }

  const myChannelIds = (myRows ?? []).map((r) => r.channel_id as string);

  if (myChannelIds.length > 0) {
    const { data: directChannels, error: chErr } = await supabase
      .from("chat_channels")
      .select("id")
      .in("id", myChannelIds)
      .eq("scope", "direct")
      .eq("channel_type", "direct");

    if (chErr) {
      return { channelId: null, error: chErr.message };
    }

    for (const ch of directChannels ?? []) {
      const cid = ch.id as string;
      const { data: otherMember, error: omErr } = await supabase
        .from("chat_channel_members")
        .select("id")
        .eq("channel_id", cid)
        .eq("user_id", otherUserId)
        .maybeSingle();

      if (!omErr && otherMember) {
        return { channelId: cid, error: null };
      }
    }
  }

  const { data: newChannel, error: insErr } = await supabase
    .from("chat_channels")
    .insert({
      name: "direct-message",
      scope: "direct",
      channel_type: "direct",
      created_by: currentUserId,
      description: null,
      property_id: null,
      is_archived: false,
    })
    .select()
    .single();

  if (insErr || !newChannel) {
    return { channelId: null, error: insErr?.message ?? "Failed to create DM channel." };
  }

  const channelId = newChannel.id as string;

  const { error: memErr } = await supabase.from("chat_channel_members").insert([
    { channel_id: channelId, user_id: currentUserId, role: "member" },
    { channel_id: channelId, user_id: otherUserId, role: "member" },
  ]);

  if (memErr) {
    return { channelId: null, error: memErr.message };
  }

  return { channelId, error: null };
}
