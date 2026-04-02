-- One-off backfill: join existing portal users (customer_users) to community channels.
-- Run after chat_channels / chat_channel_members exist and after you are happy with channel setup.
-- Matches schema in customer_companies_schema.sql: auth_user_id on customer_users, property_id on customer_companies.

-- Cross-property channels
INSERT INTO public.chat_channel_members (channel_id, user_id, role)
SELECT c.id, cu.auth_user_id, 'member'
FROM public.chat_channels c
CROSS JOIN public.customer_users cu
WHERE c.scope = 'cross_property'
  AND c.is_archived = FALSE
  AND cu.auth_user_id IS NOT NULL
ON CONFLICT (channel_id, user_id) DO NOTHING;

-- Property-scoped channels (company’s property must match channel.property_id)
INSERT INTO public.chat_channel_members (channel_id, user_id, role)
SELECT c.id, cu.auth_user_id, 'member'
FROM public.chat_channels c
JOIN public.customer_users cu ON cu.auth_user_id IS NOT NULL
JOIN public.customer_companies cc ON cc.id = cu.company_id
WHERE c.scope = 'property'
  AND c.is_archived = FALSE
  AND cc.property_id IS NOT NULL
  AND cc.property_id = c.property_id
ON CONFLICT (channel_id, user_id) DO NOTHING;
