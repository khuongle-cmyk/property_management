-- =====================================================================
-- marketing_tables_bootstrap.sql — idempotent marketing schema + RLS repair
-- Covers: marketing_campaigns, marketing_emails, marketing_sms, marketing_events,
--         marketing_offers, marketing_referrals, marketing_analytics (+ child tables).
-- Run in Supabase SQL after public.tenants, properties, leads, memberships exist.
-- Requires public.can_manage_tenant_data() for tenant write policies (see core migrations).
-- Also adds super_admin policies so global admins can use "All organizations" in the app.
-- Original module body below; safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- =====================================================================

-- Marketing module — run after tenants, properties, leads exist.
-- RLS: tenant staff read; can_manage_tenant_data for writes.

-- ---------------------------------------------------------------------------
-- Leads: marketing opt-out flags (honor in all sends)
-- ---------------------------------------------------------------------------
alter table public.leads add column if not exists email_unsubscribed boolean not null default false;
alter table public.leads add column if not exists phone_unsubscribed boolean not null default false;
comment on column public.leads.email_unsubscribed is 'Marketing emails must not be sent when true.';
comment on column public.leads.phone_unsubscribed is 'Marketing SMS must not be sent when true.';

-- ---------------------------------------------------------------------------
-- Campaigns (umbrella for channel-specific sends)
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  campaign_type text not null default 'email' check (
    campaign_type in ('email', 'sms', 'social', 'event', 'offer', 'referral')
  ),
  status text not null default 'draft' check (
    status in ('draft', 'scheduled', 'active', 'completed', 'cancelled')
  ),
  target_audience text not null default 'all_leads' check (
    target_audience in ('all_leads', 'all_tenants', 'specific_segment', 'custom_list')
  ),
  target_segment_filters jsonb not null default '{}'::jsonb,
  start_date date,
  end_date date,
  budget numeric(14, 2),
  actual_spend numeric(14, 2) not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_campaigns_tenant_idx on public.marketing_campaigns (tenant_id);
create index if not exists marketing_campaigns_status_idx on public.marketing_campaigns (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Email
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_emails (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  subject text not null default '',
  preview_text text,
  body_html text,
  body_text text,
  from_name text,
  from_email text,
  reply_to text,
  template_id text,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sent')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  recipient_count integer not null default 0,
  open_count integer not null default 0,
  click_count integer not null default 0,
  unsubscribe_count integer not null default 0,
  bounce_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists marketing_emails_tenant_idx on public.marketing_emails (tenant_id);
create index if not exists marketing_emails_campaign_idx on public.marketing_emails (campaign_id);

create table if not exists public.marketing_email_recipients (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.marketing_emails(id) on delete cascade,
  contact_id uuid references public.leads(id) on delete set null,
  email_address text not null,
  status text not null default 'pending' check (
    status in ('pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'unsubscribed')
  ),
  sent_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  open_count integer not null default 0,
  click_count integer not null default 0,
  tracking_token text unique
);
create index if not exists marketing_email_recipients_email_idx on public.marketing_email_recipients (email_id);

-- ---------------------------------------------------------------------------
-- SMS
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_sms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  message_text text not null check (char_length(message_text) <= 480),
  from_number text,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sent', 'failed')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  recipient_count integer not null default 0,
  delivered_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists marketing_sms_tenant_idx on public.marketing_sms (tenant_id);

create table if not exists public.marketing_sms_recipients (
  id uuid primary key default gen_random_uuid(),
  sms_id uuid not null references public.marketing_sms(id) on delete cascade,
  contact_id uuid references public.leads(id) on delete set null,
  phone_number text not null,
  status text not null default 'pending' check (
    status in ('pending', 'sent', 'delivered', 'failed')
  ),
  sent_at timestamptz,
  delivered_at timestamptz
);
create index if not exists marketing_sms_recipients_sms_idx on public.marketing_sms_recipients (sms_id);

-- ---------------------------------------------------------------------------
-- Social posts + OAuth connections
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_social_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'linkedin', 'facebook')),
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  external_account_id text,
  external_account_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, platform)
);
create index if not exists marketing_social_connections_tenant_idx on public.marketing_social_connections (tenant_id);

create table if not exists public.marketing_social_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  platform text not null check (platform in ('instagram', 'linkedin', 'facebook')),
  content_text text,
  media_urls jsonb not null default '[]'::jsonb,
  scheduled_at timestamptz,
  published_at timestamptz,
  status text not null default 'draft' check (
    status in ('draft', 'scheduled', 'published', 'failed')
  ),
  external_post_id text,
  likes_count integer not null default 0,
  comments_count integer not null default 0,
  shares_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists marketing_social_posts_tenant_idx on public.marketing_social_posts (tenant_id, scheduled_at);

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  slug text not null,
  name text not null,
  description text,
  event_type text not null default 'other' check (
    event_type in ('networking', 'workshop', 'open_house', 'afterwork', 'webinar', 'other')
  ),
  start_datetime timestamptz not null,
  end_datetime timestamptz not null,
  location text,
  max_attendees integer,
  is_public boolean not null default true,
  registration_required boolean not null default true,
  registration_deadline timestamptz,
  price numeric(14, 2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  cover_image_url text,
  created_at timestamptz not null default now(),
  unique (tenant_id, slug)
);
create index if not exists marketing_events_tenant_idx on public.marketing_events (tenant_id);
create index if not exists marketing_events_slug_idx on public.marketing_events (slug);

create table if not exists public.marketing_event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.marketing_events(id) on delete cascade,
  contact_id uuid references public.leads(id) on delete set null,
  name text not null,
  email text not null,
  company text,
  status text not null default 'registered' check (
    status in ('registered', 'attended', 'cancelled', 'no_show')
  ),
  registered_at timestamptz not null default now(),
  checked_in_at timestamptz,
  notes text
);
create index if not exists marketing_event_registrations_event_idx on public.marketing_event_registrations (event_id);

-- ---------------------------------------------------------------------------
-- Offers
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  name text not null,
  description text,
  offer_type text not null check (
    offer_type in ('discount_pct', 'discount_fixed', 'free_period', 'bundle', 'referral_bonus')
  ),
  discount_percentage numeric(8, 4),
  discount_fixed_amount numeric(14, 2),
  free_months integer,
  valid_from date,
  valid_until date,
  max_uses integer,
  current_uses integer not null default 0,
  promo_code text,
  applicable_to text not null default 'all' check (
    applicable_to in ('offices', 'meeting_rooms', 'hot_desks', 'venues', 'all')
  ),
  status text not null default 'draft' check (status in ('draft', 'active', 'expired')),
  terms text,
  created_at timestamptz not null default now()
);
create index if not exists marketing_offers_tenant_idx on public.marketing_offers (tenant_id);
create unique index if not exists marketing_offers_promo_uq on public.marketing_offers (tenant_id, (lower(promo_code)))
  where promo_code is not null and promo_code <> '';

-- ---------------------------------------------------------------------------
-- Referrals
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_referrals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  referrer_contact_id uuid references public.leads(id) on delete set null,
  referred_contact_id uuid references public.leads(id) on delete set null,
  referral_code text not null,
  status text not null default 'pending' check (
    status in ('pending', 'qualified', 'converted', 'rewarded')
  ),
  reward_type text check (reward_type in ('discount', 'cash', 'gift')),
  reward_amount numeric(14, 2),
  reward_paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists marketing_referrals_tenant_idx on public.marketing_referrals (tenant_id);
create unique index if not exists marketing_referrals_code_uq on public.marketing_referrals (tenant_id, (lower(referral_code)));

-- ---------------------------------------------------------------------------
-- Analytics (daily rollup per channel)
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_analytics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  date date not null,
  source text not null check (
    source in (
      'direct', 'google', 'linkedin', 'facebook', 'instagram', 'referral',
      'email', 'sms', 'other'
    )
  ),
  website_visitors integer not null default 0,
  new_leads integer not null default 0,
  bookings_made integer not null default 0,
  revenue_attributed numeric(14, 2) not null default 0,
  ad_spend numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, date, source)
);
create index if not exists marketing_analytics_tenant_date_idx on public.marketing_analytics (tenant_id, date desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.marketing_campaigns enable row level security;
alter table public.marketing_emails enable row level security;
alter table public.marketing_email_recipients enable row level security;
alter table public.marketing_sms enable row level security;
alter table public.marketing_sms_recipients enable row level security;
alter table public.marketing_social_connections enable row level security;
alter table public.marketing_social_posts enable row level security;
alter table public.marketing_events enable row level security;
alter table public.marketing_event_registrations enable row level security;
alter table public.marketing_offers enable row level security;
alter table public.marketing_referrals enable row level security;
alter table public.marketing_analytics enable row level security;

-- Helper: marketing read roles
-- SELECT policies
drop policy if exists marketing_campaigns_select on public.marketing_campaigns;
create policy marketing_campaigns_select on public.marketing_campaigns for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.tenant_id = marketing_campaigns.tenant_id
      and lower(coalesce(m.role,'')) in (
        'owner','manager','customer_service','accounting','viewer','agent','super_admin'
      )
  )
);
drop policy if exists marketing_campaigns_write on public.marketing_campaigns;
create policy marketing_campaigns_write on public.marketing_campaigns for all using (
  public.can_manage_tenant_data(marketing_campaigns.tenant_id)
) with check (public.can_manage_tenant_data(marketing_campaigns.tenant_id));

drop policy if exists marketing_emails_select on public.marketing_emails;
create policy marketing_emails_select on public.marketing_emails for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.tenant_id = marketing_emails.tenant_id
      and lower(coalesce(m.role,'')) in (
        'owner','manager','customer_service','accounting','viewer','agent','super_admin'
      )
  )
);
drop policy if exists marketing_emails_write on public.marketing_emails;
create policy marketing_emails_write on public.marketing_emails for all using (
  public.can_manage_tenant_data(marketing_emails.tenant_id)
) with check (public.can_manage_tenant_data(marketing_emails.tenant_id));

drop policy if exists marketing_email_recipients_select on public.marketing_email_recipients;
create policy marketing_email_recipients_select on public.marketing_email_recipients for select using (
  exists (
    select 1 from public.marketing_emails e
    join public.memberships m on m.tenant_id = e.tenant_id and m.user_id = auth.uid()
    where e.id = marketing_email_recipients.email_id
      and lower(coalesce(m.role,'')) in (
        'owner','manager','customer_service','accounting','viewer','agent','super_admin'
      )
  )
);
drop policy if exists marketing_email_recipients_write on public.marketing_email_recipients;
create policy marketing_email_recipients_write on public.marketing_email_recipients for all using (
  exists (
    select 1 from public.marketing_emails e
    where e.id = marketing_email_recipients.email_id
      and public.can_manage_tenant_data(e.tenant_id)
  )
) with check (
  exists (
    select 1 from public.marketing_emails e
    where e.id = marketing_email_recipients.email_id
      and public.can_manage_tenant_data(e.tenant_id)
  )
);

drop policy if exists marketing_sms_select on public.marketing_sms;
create policy marketing_sms_select on public.marketing_sms for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.tenant_id = marketing_sms.tenant_id
      and lower(coalesce(m.role,'')) in (
        'owner','manager','customer_service','accounting','viewer','agent','super_admin'
      )
  )
);
drop policy if exists marketing_sms_write on public.marketing_sms;
create policy marketing_sms_write on public.marketing_sms for all using (
  public.can_manage_tenant_data(marketing_sms.tenant_id)
) with check (public.can_manage_tenant_data(marketing_sms.tenant_id));

drop policy if exists marketing_sms_recipients_select on public.marketing_sms_recipients;
create policy marketing_sms_recipients_select on public.marketing_sms_recipients for select using (
  exists (
    select 1 from public.marketing_sms s
    join public.memberships m on m.tenant_id = s.tenant_id and m.user_id = auth.uid()
    where s.id = marketing_sms_recipients.sms_id
      and lower(coalesce(m.role,'')) in (
        'owner','manager','customer_service','accounting','viewer','agent','super_admin'
      )
  )
);
drop policy if exists marketing_sms_recipients_write on public.marketing_sms_recipients;
create policy marketing_sms_recipients_write on public.marketing_sms_recipients for all using (
  exists (
    select 1 from public.marketing_sms s
    where s.id = marketing_sms_recipients.sms_id
      and public.can_manage_tenant_data(s.tenant_id)
  )
) with check (
  exists (
    select 1 from public.marketing_sms s
    where s.id = marketing_sms_recipients.sms_id
      and public.can_manage_tenant_data(s.tenant_id)
  )
);

drop policy if exists marketing_social_connections_select on public.marketing_social_connections;
create policy marketing_social_connections_select on public.marketing_social_connections for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.tenant_id = marketing_social_connections.tenant_id
      and lower(coalesce(m.role,'')) in (
        'owner','manager','customer_service','viewer','super_admin'
      )
  )
);
drop policy if exists marketing_social_connections_write on public.marketing_social_connections;
create policy marketing_social_connections_write on public.marketing_social_connections for all using (
  public.can_manage_tenant_data(marketing_social_connections.tenant_id)
) with check (public.can_manage_tenant_data(marketing_social_connections.tenant_id));

drop policy if exists marketing_social_posts_select on public.marketing_social_posts;
create policy marketing_social_posts_select on public.marketing_social_posts for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.tenant_id = marketing_social_posts.tenant_id
      and lower(coalesce(m.role,'')) in (
        'owner','manager','customer_service','accounting','viewer','agent','super_admin'
      )
  )
);
drop policy if exists marketing_social_posts_write on public.marketing_social_posts;
create policy marketing_social_posts_write on public.marketing_social_posts for all using (
  public.can_manage_tenant_data(marketing_social_posts.tenant_id)
) with check (public.can_manage_tenant_data(marketing_social_posts.tenant_id));

drop policy if exists marketing_events_select on public.marketing_events;
create policy marketing_events_select on public.marketing_events for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.tenant_id = marketing_events.tenant_id
      and lower(coalesce(m.role,'')) in (
        'owner','manager','customer_service','accounting','viewer','agent','super_admin'
      )
  )
  or (status = 'published' and is_public = true)
);
drop policy if exists marketing_events_write on public.marketing_events;
create policy marketing_events_write on public.marketing_events for all using (
  public.can_manage_tenant_data(marketing_events.tenant_id)
) with check (public.can_manage_tenant_data(marketing_events.tenant_id));

-- Public read published events (registration page uses anon or service — use service in API)
drop policy if exists marketing_events_public_select on public.marketing_events;
-- RLS above already allows is_public=true for any authenticated user — anon needs separate policy:
drop policy if exists marketing_events_anon_select on public.marketing_events;
create policy marketing_events_anon_select on public.marketing_events for select to anon using (
  status = 'published' and is_public = true
);

drop policy if exists marketing_event_registrations_select on public.marketing_event_registrations;
create policy marketing_event_registrations_select on public.marketing_event_registrations for select using (
  exists (
    select 1 from public.marketing_events ev
    join public.memberships m on m.tenant_id = ev.tenant_id and m.user_id = auth.uid()
    where ev.id = marketing_event_registrations.event_id
      and lower(coalesce(m.role,'')) in (
        'owner','manager','customer_service','accounting','viewer','agent','super_admin'
      )
  )
);
drop policy if exists marketing_event_registrations_write on public.marketing_event_registrations;
create policy marketing_event_registrations_write on public.marketing_event_registrations for all using (
  exists (
    select 1 from public.marketing_events ev
    where ev.id = marketing_event_registrations.event_id
      and public.can_manage_tenant_data(ev.tenant_id)
  )
) with check (
  exists (
    select 1 from public.marketing_events ev
    where ev.id = marketing_event_registrations.event_id
      and public.can_manage_tenant_data(ev.tenant_id)
  )
);

drop policy if exists marketing_event_registrations_insert_public on public.marketing_event_registrations;
create policy marketing_event_registrations_insert_public on public.marketing_event_registrations for insert to anon with check (
  exists (
    select 1 from public.marketing_events ev
    where ev.id = marketing_event_registrations.event_id
      and ev.status = 'published' and ev.is_public = true
      and (ev.registration_required = false or ev.registration_deadline is null or ev.registration_deadline > now())
  )
);

drop policy if exists marketing_offers_select on public.marketing_offers;
create policy marketing_offers_select on public.marketing_offers for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.tenant_id = marketing_offers.tenant_id
      and lower(coalesce(m.role,'')) in (
        'owner','manager','customer_service','accounting','viewer','agent','super_admin'
      )
  )
);
drop policy if exists marketing_offers_write on public.marketing_offers;
create policy marketing_offers_write on public.marketing_offers for all using (
  public.can_manage_tenant_data(marketing_offers.tenant_id)
) with check (public.can_manage_tenant_data(marketing_offers.tenant_id));

drop policy if exists marketing_referrals_select on public.marketing_referrals;
create policy marketing_referrals_select on public.marketing_referrals for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.tenant_id = marketing_referrals.tenant_id
      and lower(coalesce(m.role,'')) in (
        'owner','manager','customer_service','accounting','viewer','agent','super_admin'
      )
  )
);
drop policy if exists marketing_referrals_write on public.marketing_referrals;
create policy marketing_referrals_write on public.marketing_referrals for all using (
  public.can_manage_tenant_data(marketing_referrals.tenant_id)
) with check (public.can_manage_tenant_data(marketing_referrals.tenant_id));

drop policy if exists marketing_analytics_select on public.marketing_analytics;
create policy marketing_analytics_select on public.marketing_analytics for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.tenant_id = marketing_analytics.tenant_id
      and lower(coalesce(m.role,'')) in (
        'owner','manager','customer_service','accounting','viewer','super_admin'
      )
  )
);
drop policy if exists marketing_analytics_write on public.marketing_analytics;
create policy marketing_analytics_write on public.marketing_analytics for all using (
  public.can_manage_tenant_data(marketing_analytics.tenant_id)
) with check (public.can_manage_tenant_data(marketing_analytics.tenant_id));

-- ---------------------------------------------------------------------------
-- Super admin (membership role only — no tenant_id match): stacked OR with policies above
-- ---------------------------------------------------------------------------
drop policy if exists marketing_campaigns_bootstrap_super on public.marketing_campaigns;
create policy marketing_campaigns_bootstrap_super on public.marketing_campaigns for all to authenticated using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
) with check (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
);

drop policy if exists marketing_emails_bootstrap_super on public.marketing_emails;
create policy marketing_emails_bootstrap_super on public.marketing_emails for all to authenticated using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
) with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
);

drop policy if exists marketing_email_recipients_bootstrap_super on public.marketing_email_recipients;
create policy marketing_email_recipients_bootstrap_super on public.marketing_email_recipients for all to authenticated using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
) with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
);

drop policy if exists marketing_sms_bootstrap_super on public.marketing_sms;
create policy marketing_sms_bootstrap_super on public.marketing_sms for all to authenticated using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
) with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
);

drop policy if exists marketing_sms_recipients_bootstrap_super on public.marketing_sms_recipients;
create policy marketing_sms_recipients_bootstrap_super on public.marketing_sms_recipients for all to authenticated using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
) with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
);

drop policy if exists marketing_social_connections_bootstrap_super on public.marketing_social_connections;
create policy marketing_social_connections_bootstrap_super on public.marketing_social_connections for all to authenticated using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
) with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
);

drop policy if exists marketing_social_posts_bootstrap_super on public.marketing_social_posts;
create policy marketing_social_posts_bootstrap_super on public.marketing_social_posts for all to authenticated using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
) with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
);

drop policy if exists marketing_events_bootstrap_super on public.marketing_events;
create policy marketing_events_bootstrap_super on public.marketing_events for all to authenticated using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
) with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
);

drop policy if exists marketing_event_registrations_bootstrap_super on public.marketing_event_registrations;
create policy marketing_event_registrations_bootstrap_super on public.marketing_event_registrations for all to authenticated using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
) with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
);

drop policy if exists marketing_offers_bootstrap_super on public.marketing_offers;
create policy marketing_offers_bootstrap_super on public.marketing_offers for all to authenticated using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
) with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
);

drop policy if exists marketing_referrals_bootstrap_super on public.marketing_referrals;
create policy marketing_referrals_bootstrap_super on public.marketing_referrals for all to authenticated using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
) with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
);

drop policy if exists marketing_analytics_bootstrap_super on public.marketing_analytics;
create policy marketing_analytics_bootstrap_super on public.marketing_analytics for all to authenticated using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
) with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(trim(coalesce(m.role::text, ''))) = 'super_admin')
);

comment on table public.marketing_campaigns is 'Marketing campaign umbrella (email, SMS, social, etc.).';
comment on table public.marketing_social_connections is 'OAuth tokens for social scheduling (encrypt at rest in production).';
