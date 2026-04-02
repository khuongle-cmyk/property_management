-- =====================================================================
-- marketing_null_tenant_global.sql
-- Allow tenant_id NULL on marketing rows = "all organizations" scope.
-- Run in Supabase SQL editor after marketing module exists.
-- Then: NOTIFY pgrst, 'reload schema';
--
-- Security: rows with tenant_id IS NULL are readable/writable by any user who
-- has a marketing-capable membership on ANY tenant (see RLS below). Suitable
-- when one operator team manages the whole product; avoid if you need strict
-- isolation between unrelated customers on shared infrastructure.
--
-- If ALTER TABLE marketing_events DROP CONSTRAINT fails, inspect:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'public.marketing_events'::regclass;
-- =====================================================================

CREATE OR REPLACE FUNCTION public.user_has_marketing_any_tenant()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) IN (
        'owner','manager','customer_service','accounting','viewer','agent','super_admin'
      )
  );
$$;

-- Nullable FKs (keep references; NULL = global row)
ALTER TABLE public.marketing_campaigns ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.marketing_emails ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.marketing_sms ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.marketing_social_posts ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.marketing_events ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.marketing_offers ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.marketing_referrals ALTER COLUMN tenant_id DROP NOT NULL;

-- Offers: per-tenant + global unique promo codes
DROP INDEX IF EXISTS public.marketing_offers_promo_uq;
CREATE UNIQUE INDEX IF NOT EXISTS marketing_offers_promo_per_tenant_uq
  ON public.marketing_offers (tenant_id, lower(promo_code))
  WHERE promo_code IS NOT NULL AND promo_code <> '' AND tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS marketing_offers_promo_global_uq
  ON public.marketing_offers (lower(promo_code))
  WHERE promo_code IS NOT NULL AND promo_code <> '' AND tenant_id IS NULL;

-- Referrals
DROP INDEX IF EXISTS public.marketing_referrals_code_uq;
CREATE UNIQUE INDEX IF NOT EXISTS marketing_referrals_code_per_tenant_uq
  ON public.marketing_referrals (tenant_id, lower(referral_code))
  WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS marketing_referrals_code_global_uq
  ON public.marketing_referrals (lower(referral_code))
  WHERE tenant_id IS NULL;

-- Events: unique slug per tenant; global events one slug each
ALTER TABLE public.marketing_events DROP CONSTRAINT IF EXISTS marketing_events_tenant_id_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS marketing_events_tenant_slug_uq
  ON public.marketing_events (tenant_id, slug)
  WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS marketing_events_slug_global_uq
  ON public.marketing_events (lower(slug))
  WHERE tenant_id IS NULL;

-- ---------------------------------------------------------------------------
-- RLS: tenant-matched rows OR (tenant_id IS NULL AND any marketing membership)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS marketing_campaigns_select ON public.marketing_campaigns;
CREATE POLICY marketing_campaigns_select ON public.marketing_campaigns FOR SELECT USING (
  (
    marketing_campaigns.tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid() AND m.tenant_id = marketing_campaigns.tenant_id
        AND lower(coalesce(m.role,'')) IN (
          'owner','manager','customer_service','accounting','viewer','agent','super_admin'
        )
    )
  )
  OR (
    marketing_campaigns.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
);
DROP POLICY IF EXISTS marketing_campaigns_write ON public.marketing_campaigns;
CREATE POLICY marketing_campaigns_write ON public.marketing_campaigns FOR ALL USING (
  (
    marketing_campaigns.tenant_id IS NOT NULL
    AND public.can_manage_tenant_data(marketing_campaigns.tenant_id)
  )
  OR (
    marketing_campaigns.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
) WITH CHECK (
  (
    marketing_campaigns.tenant_id IS NOT NULL
    AND public.can_manage_tenant_data(marketing_campaigns.tenant_id)
  )
  OR (
    marketing_campaigns.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
);

DROP POLICY IF EXISTS marketing_emails_select ON public.marketing_emails;
CREATE POLICY marketing_emails_select ON public.marketing_emails FOR SELECT USING (
  (
    marketing_emails.tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid() AND m.tenant_id = marketing_emails.tenant_id
        AND lower(coalesce(m.role,'')) IN (
          'owner','manager','customer_service','accounting','viewer','agent','super_admin'
        )
    )
  )
  OR (
    marketing_emails.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
);
DROP POLICY IF EXISTS marketing_emails_write ON public.marketing_emails;
CREATE POLICY marketing_emails_write ON public.marketing_emails FOR ALL USING (
  (
    marketing_emails.tenant_id IS NOT NULL
    AND public.can_manage_tenant_data(marketing_emails.tenant_id)
  )
  OR (
    marketing_emails.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
) WITH CHECK (
  (
    marketing_emails.tenant_id IS NOT NULL
    AND public.can_manage_tenant_data(marketing_emails.tenant_id)
  )
  OR (
    marketing_emails.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
);

DROP POLICY IF EXISTS marketing_email_recipients_select ON public.marketing_email_recipients;
CREATE POLICY marketing_email_recipients_select ON public.marketing_email_recipients FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.marketing_emails e
    WHERE e.id = marketing_email_recipients.email_id
    AND (
      (
        e.tenant_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.memberships m
          WHERE m.user_id = auth.uid() AND m.tenant_id = e.tenant_id
            AND lower(coalesce(m.role,'')) IN (
              'owner','manager','customer_service','accounting','viewer','agent','super_admin'
            )
        )
      )
      OR (
        e.tenant_id IS NULL
        AND public.user_has_marketing_any_tenant()
      )
    )
  )
);
DROP POLICY IF EXISTS marketing_email_recipients_write ON public.marketing_email_recipients;
CREATE POLICY marketing_email_recipients_write ON public.marketing_email_recipients FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.marketing_emails e
    WHERE e.id = marketing_email_recipients.email_id
    AND (
      (e.tenant_id IS NOT NULL AND public.can_manage_tenant_data(e.tenant_id))
      OR (e.tenant_id IS NULL AND public.user_has_marketing_any_tenant())
    )
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.marketing_emails e
    WHERE e.id = marketing_email_recipients.email_id
    AND (
      (e.tenant_id IS NOT NULL AND public.can_manage_tenant_data(e.tenant_id))
      OR (e.tenant_id IS NULL AND public.user_has_marketing_any_tenant())
    )
  )
);

DROP POLICY IF EXISTS marketing_sms_select ON public.marketing_sms;
CREATE POLICY marketing_sms_select ON public.marketing_sms FOR SELECT USING (
  (
    marketing_sms.tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid() AND m.tenant_id = marketing_sms.tenant_id
        AND lower(coalesce(m.role,'')) IN (
          'owner','manager','customer_service','accounting','viewer','agent','super_admin'
        )
    )
  )
  OR (
    marketing_sms.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
);
DROP POLICY IF EXISTS marketing_sms_write ON public.marketing_sms;
CREATE POLICY marketing_sms_write ON public.marketing_sms FOR ALL USING (
  (
    marketing_sms.tenant_id IS NOT NULL
    AND public.can_manage_tenant_data(marketing_sms.tenant_id)
  )
  OR (
    marketing_sms.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
) WITH CHECK (
  (
    marketing_sms.tenant_id IS NOT NULL
    AND public.can_manage_tenant_data(marketing_sms.tenant_id)
  )
  OR (
    marketing_sms.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
);

DROP POLICY IF EXISTS marketing_sms_recipients_select ON public.marketing_sms_recipients;
CREATE POLICY marketing_sms_recipients_select ON public.marketing_sms_recipients FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.marketing_sms s
    WHERE s.id = marketing_sms_recipients.sms_id
    AND (
      (
        s.tenant_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.memberships m
          WHERE m.user_id = auth.uid() AND m.tenant_id = s.tenant_id
            AND lower(coalesce(m.role,'')) IN (
              'owner','manager','customer_service','accounting','viewer','agent','super_admin'
            )
        )
      )
      OR (
        s.tenant_id IS NULL
        AND public.user_has_marketing_any_tenant()
      )
    )
  )
);
DROP POLICY IF EXISTS marketing_sms_recipients_write ON public.marketing_sms_recipients;
CREATE POLICY marketing_sms_recipients_write ON public.marketing_sms_recipients FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.marketing_sms s
    WHERE s.id = marketing_sms_recipients.sms_id
    AND (
      (s.tenant_id IS NOT NULL AND public.can_manage_tenant_data(s.tenant_id))
      OR (s.tenant_id IS NULL AND public.user_has_marketing_any_tenant())
    )
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.marketing_sms s
    WHERE s.id = marketing_sms_recipients.sms_id
    AND (
      (s.tenant_id IS NOT NULL AND public.can_manage_tenant_data(s.tenant_id))
      OR (s.tenant_id IS NULL AND public.user_has_marketing_any_tenant())
    )
  )
);

DROP POLICY IF EXISTS marketing_social_posts_select ON public.marketing_social_posts;
CREATE POLICY marketing_social_posts_select ON public.marketing_social_posts FOR SELECT USING (
  (
    marketing_social_posts.tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid() AND m.tenant_id = marketing_social_posts.tenant_id
        AND lower(coalesce(m.role,'')) IN (
          'owner','manager','customer_service','accounting','viewer','agent','super_admin'
        )
    )
  )
  OR (
    marketing_social_posts.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
);
DROP POLICY IF EXISTS marketing_social_posts_write ON public.marketing_social_posts;
CREATE POLICY marketing_social_posts_write ON public.marketing_social_posts FOR ALL USING (
  (
    marketing_social_posts.tenant_id IS NOT NULL
    AND public.can_manage_tenant_data(marketing_social_posts.tenant_id)
  )
  OR (
    marketing_social_posts.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
) WITH CHECK (
  (
    marketing_social_posts.tenant_id IS NOT NULL
    AND public.can_manage_tenant_data(marketing_social_posts.tenant_id)
  )
  OR (
    marketing_social_posts.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
);

DROP POLICY IF EXISTS marketing_events_select ON public.marketing_events;
CREATE POLICY marketing_events_select ON public.marketing_events FOR SELECT USING (
  (
    marketing_events.tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid() AND m.tenant_id = marketing_events.tenant_id
        AND lower(coalesce(m.role,'')) IN (
          'owner','manager','customer_service','accounting','viewer','agent','super_admin'
        )
    )
  )
  OR (
    marketing_events.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
  OR (status = 'published' AND is_public = true)
);
DROP POLICY IF EXISTS marketing_events_write ON public.marketing_events;
CREATE POLICY marketing_events_write ON public.marketing_events FOR ALL USING (
  (
    marketing_events.tenant_id IS NOT NULL
    AND public.can_manage_tenant_data(marketing_events.tenant_id)
  )
  OR (
    marketing_events.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
) WITH CHECK (
  (
    marketing_events.tenant_id IS NOT NULL
    AND public.can_manage_tenant_data(marketing_events.tenant_id)
  )
  OR (
    marketing_events.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
);

DROP POLICY IF EXISTS marketing_event_registrations_select ON public.marketing_event_registrations;
CREATE POLICY marketing_event_registrations_select ON public.marketing_event_registrations FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.marketing_events ev
    WHERE ev.id = marketing_event_registrations.event_id
    AND (
      (
        ev.tenant_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.memberships m
          WHERE m.user_id = auth.uid() AND m.tenant_id = ev.tenant_id
            AND lower(coalesce(m.role,'')) IN (
              'owner','manager','customer_service','accounting','viewer','agent','super_admin'
            )
        )
      )
      OR (
        ev.tenant_id IS NULL
        AND public.user_has_marketing_any_tenant()
      )
    )
  )
);
DROP POLICY IF EXISTS marketing_event_registrations_write ON public.marketing_event_registrations;
CREATE POLICY marketing_event_registrations_write ON public.marketing_event_registrations FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.marketing_events ev
    WHERE ev.id = marketing_event_registrations.event_id
    AND (
      (ev.tenant_id IS NOT NULL AND public.can_manage_tenant_data(ev.tenant_id))
      OR (ev.tenant_id IS NULL AND public.user_has_marketing_any_tenant())
    )
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.marketing_events ev
    WHERE ev.id = marketing_event_registrations.event_id
    AND (
      (ev.tenant_id IS NOT NULL AND public.can_manage_tenant_data(ev.tenant_id))
      OR (ev.tenant_id IS NULL AND public.user_has_marketing_any_tenant())
    )
  )
);

DROP POLICY IF EXISTS marketing_offers_select ON public.marketing_offers;
CREATE POLICY marketing_offers_select ON public.marketing_offers FOR SELECT USING (
  (
    marketing_offers.tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid() AND m.tenant_id = marketing_offers.tenant_id
        AND lower(coalesce(m.role,'')) IN (
          'owner','manager','customer_service','accounting','viewer','agent','super_admin'
        )
    )
  )
  OR (
    marketing_offers.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
);
DROP POLICY IF EXISTS marketing_offers_write ON public.marketing_offers;
CREATE POLICY marketing_offers_write ON public.marketing_offers FOR ALL USING (
  (
    marketing_offers.tenant_id IS NOT NULL
    AND public.can_manage_tenant_data(marketing_offers.tenant_id)
  )
  OR (
    marketing_offers.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
) WITH CHECK (
  (
    marketing_offers.tenant_id IS NOT NULL
    AND public.can_manage_tenant_data(marketing_offers.tenant_id)
  )
  OR (
    marketing_offers.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
);

DROP POLICY IF EXISTS marketing_referrals_select ON public.marketing_referrals;
CREATE POLICY marketing_referrals_select ON public.marketing_referrals FOR SELECT USING (
  (
    marketing_referrals.tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid() AND m.tenant_id = marketing_referrals.tenant_id
        AND lower(coalesce(m.role,'')) IN (
          'owner','manager','customer_service','accounting','viewer','agent','super_admin'
        )
    )
  )
  OR (
    marketing_referrals.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
);
DROP POLICY IF EXISTS marketing_referrals_write ON public.marketing_referrals;
CREATE POLICY marketing_referrals_write ON public.marketing_referrals FOR ALL USING (
  (
    marketing_referrals.tenant_id IS NOT NULL
    AND public.can_manage_tenant_data(marketing_referrals.tenant_id)
  )
  OR (
    marketing_referrals.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
) WITH CHECK (
  (
    marketing_referrals.tenant_id IS NOT NULL
    AND public.can_manage_tenant_data(marketing_referrals.tenant_id)
  )
  OR (
    marketing_referrals.tenant_id IS NULL
    AND public.user_has_marketing_any_tenant()
  )
);

NOTIFY pgrst, 'reload schema';
