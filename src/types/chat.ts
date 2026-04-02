export interface ChatChannel {
  id: string;
  name: string;
  description: string | null;
  property_id: string | null;
  scope: "property" | "cross_property" | "direct";
  channel_type: "general" | "announcements" | "support" | "social" | "direct";
  is_archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatChannelMember {
  id: string;
  channel_id: string;
  user_id: string;
  role: "member" | "moderator" | "admin";
  notifications_enabled: boolean;
  joined_at: string;
}

export interface ChatMessage {
  id: string;
  channel_id: string;
  user_id: string | null;
  content: string;
  is_ai_response: boolean;
  is_system_message: boolean;
  is_edited: boolean;
  is_deleted: boolean;
  parent_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatReadStatus {
  id: string;
  channel_id: string;
  user_id: string;
  last_read_at: string;
}
