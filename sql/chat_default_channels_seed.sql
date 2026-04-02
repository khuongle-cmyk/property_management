-- Default channels per property (run after chat tables exist)
-- Replace property UUIDs with your real IDs for property-specific channels.

INSERT INTO public.chat_channels (name, description, scope, channel_type)
VALUES
  ('general', 'General discussion across all VillageWorks locations', 'cross_property', 'general'),
  ('announcements', 'Important updates from VillageWorks management', 'cross_property', 'announcements'),
  ('events', 'Community events, meetups, and activities', 'cross_property', 'social')
ON CONFLICT DO NOTHING;

-- Example property-specific channel:
-- INSERT INTO public.chat_channels (name, description, property_id, scope, channel_type)
-- VALUES ('erottaja-general', 'Erottaja2 community', '<erottaja-uuid>', 'property', 'general');
