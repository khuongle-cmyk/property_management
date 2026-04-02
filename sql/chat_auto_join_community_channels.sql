-- Auto-join users to community chat channels when they are linked to a property or tenant.
-- Run after chat_channels / chat_channel_members exist and have the expected columns.
-- Requires unique constraint on chat_channel_members (channel_id, user_id).

-- Use this trigger target when NEW has user_id + property_id (e.g. a per-property assignment row).
CREATE OR REPLACE FUNCTION public.auto_join_community_channels()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT c.id, NEW.user_id, 'member'
  FROM public.chat_channels c
  WHERE c.scope = 'cross_property'
    AND c.is_archived = FALSE
  ON CONFLICT (channel_id, user_id) DO NOTHING;

  IF NEW.property_id IS NOT NULL THEN
    INSERT INTO public.chat_channel_members (channel_id, user_id, role)
    SELECT c.id, NEW.user_id, 'member'
    FROM public.chat_channels c
    WHERE c.property_id = NEW.property_id
      AND c.scope = 'property'
      AND c.is_archived = FALSE
    ON CONFLICT (channel_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Use on public.memberships: joins cross-tenant channels + property-scoped channels for all
-- properties in NEW.tenant_id.
CREATE OR REPLACE FUNCTION public.auto_join_community_channels_from_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT c.id, NEW.user_id, 'member'
  FROM public.chat_channels c
  WHERE c.scope = 'cross_property'
    AND c.is_archived = FALSE
  ON CONFLICT (channel_id, user_id) DO NOTHING;

  IF NEW.tenant_id IS NOT NULL THEN
    INSERT INTO public.chat_channel_members (channel_id, user_id, role)
    SELECT c.id, NEW.user_id, 'member'
    FROM public.chat_channels c
    INNER JOIN public.properties p ON p.id = c.property_id
    WHERE p.tenant_id = NEW.tenant_id
      AND c.scope = 'property'
      AND c.is_archived = FALSE
    ON CONFLICT (channel_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- customer_users: auth_user_id + property_id from customer_companies (not columns on the row itself).
CREATE OR REPLACE FUNCTION public.auto_join_community_channels_from_customer_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_id uuid;
BEGIN
  IF NEW.auth_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT c.id, NEW.auth_user_id, 'member'
  FROM public.chat_channels c
  WHERE c.scope = 'cross_property'
    AND c.is_archived = FALSE
  ON CONFLICT (channel_id, user_id) DO NOTHING;

  SELECT cc.property_id INTO v_property_id
  FROM public.customer_companies cc
  WHERE cc.id = NEW.company_id;

  IF v_property_id IS NOT NULL THEN
    INSERT INTO public.chat_channel_members (channel_id, user_id, role)
    SELECT c.id, NEW.auth_user_id, 'member'
    FROM public.chat_channels c
    WHERE c.property_id = v_property_id
      AND c.scope = 'property'
      AND c.is_archived = FALSE
    ON CONFLICT (channel_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_auto_join_community_channels_membership ON public.memberships;
CREATE TRIGGER tr_auto_join_community_channels_membership
  AFTER INSERT ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_join_community_channels_from_membership();

-- Portal: customer_users has auth_user_id and company_id (property via customer_companies).
-- Do not use auto_join_community_channels() here — it expects NEW.user_id / NEW.property_id.
DROP TRIGGER IF EXISTS trg_auto_join_community ON public.customer_users;
CREATE TRIGGER trg_auto_join_community
  AFTER INSERT ON public.customer_users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_join_community_channels_from_customer_user();

-- Example: table with (user_id, property_id) on the row itself:
-- DROP TRIGGER IF EXISTS tr_auto_join_community_channels_property ON public.your_assignment_table;
-- CREATE TRIGGER tr_auto_join_community_channels_property
--   AFTER INSERT ON public.your_assignment_table
--   FOR EACH ROW
--   EXECUTE FUNCTION public.auto_join_community_channels();
