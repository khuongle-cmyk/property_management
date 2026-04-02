-- Direct messaging: allow scope and channel_type "direct" on chat_channels.
-- Run in Supabase if you use CHECK constraints on these columns; adjust names to match your schema.

-- Example if scope is an enum type — extend enum (PostgreSQL):
-- ALTER TYPE chat_channel_scope ADD VALUE IF NOT EXISTS 'direct';

-- If scope/channel_type are plain text with CHECK constraints, relax or recreate:
-- ALTER TABLE public.chat_channels DROP CONSTRAINT IF EXISTS chat_channels_scope_check;
-- ALTER TABLE public.chat_channels ADD CONSTRAINT chat_channels_scope_check
--   CHECK (scope IN ('property', 'cross_property', 'direct'));

-- notify pgrst, 'reload schema';
