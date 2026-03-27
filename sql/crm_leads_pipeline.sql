-- =====================================================================
-- CRM + Sales Pipeline tables and policies
-- Run after core schema (tenants/users/memberships/properties) exists.
-- =====================================================================

create extension if not exists pgcrypto;

-- Ensure "agent" role is allowed for memberships.
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships
  add constraint memberships_role_check check (
    role in (
      'super_admin',
      'owner',
      'manager',
      'customer_service',
      'accounting',
      'maintenance',
      'tenant',
      'viewer',
      'agent'
    )
  );

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 'platform' for VillageWorks-level pipeline, or tenant UUID string for owner pipeline.
  pipeline_owner text not null default 'platform',
  property_id uuid references public.properties(id) on delete set null,
  company_name text not null,
  contact_person_name text not null,
  business_id text,
  vat_number text,
  company_type text,
  industry_sector text,
  company_size text,
  company_website text,
  billing_street text,
  billing_postal_code text,
  billing_city text,
  billing_email text,
  e_invoice_address text,
  e_invoice_operator_code text,
  contact_first_name text,
  contact_last_name text,
  contact_title text,
  contact_direct_phone text,
  email text not null,
  phone text,
  source text not null default 'other',
  interested_space_type text,
  approx_size_m2 numeric(12, 2),
  approx_budget_eur_month numeric(12, 2),
  preferred_move_in_date date,
  notes text,
  assigned_agent_user_id uuid references public.users(id) on delete set null,
  created_by_user_id uuid references public.users(id) on delete set null,
  stage text not null default 'new',
  stage_notes text,
  stage_changed_at timestamptz not null default now(),
  next_action text,
  next_action_date date,
  lost_reason text,
  won_room_id uuid references public.bookable_spaces(id) on delete set null,
  won_proposal_id uuid references public.room_proposals(id) on delete set null,
  won_at timestamptz,
  archived boolean not null default false,
  won_client_tenant_id uuid references public.tenants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_source_check check (
    source in ('email', 'website', 'phone', 'chatbot', 'social_media', 'referral', 'other')
  ),
  constraint leads_stage_check check (
    stage in ('new', 'contacted', 'viewing', 'offer_sent', 'negotiation', 'won', 'lost')
  ),
  constraint leads_lost_reason_check check (
    lost_reason is null or lost_reason in (
      'price_too_high',
      'space_too_small',
      'space_too_large',
      'chose_competitor',
      'no_longer_needed',
      'other'
    )
  ),
  constraint leads_space_type_check check (
    interested_space_type is null or interested_space_type in ('office', 'meeting_room', 'venue', 'hot_desk')
  ),
  constraint leads_company_type_check check (
    company_type is null or company_type in ('oy', 'oyj', 'ky', 'ay', 'toiminimi', 'other')
  ),
  constraint leads_company_size_check check (
    company_size is null or company_size in ('1-10', '11-50', '51-200', '200+')
  ),
  constraint leads_pipeline_owner_check check (
    pipeline_owner = 'platform' or pipeline_owner = tenant_id::text
  )
);

create index if not exists leads_tenant_idx on public.leads(tenant_id);
create index if not exists leads_pipeline_owner_idx on public.leads(pipeline_owner);
create index if not exists leads_property_idx on public.leads(property_id);
create index if not exists leads_stage_idx on public.leads(stage);
create index if not exists leads_agent_idx on public.leads(assigned_agent_user_id);
create index if not exists leads_created_idx on public.leads(created_at desc);

create table if not exists public.lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  changed_by_user_id uuid references public.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  notes text,
  assigned_agent_user_id uuid references public.users(id) on delete set null,
  next_action text,
  next_action_date date,
  lost_reason text,
  constraint lead_stage_history_stage_check check (
    to_stage in ('new', 'contacted', 'viewing', 'offer_sent', 'negotiation', 'won', 'lost')
  )
);

create index if not exists lead_stage_history_lead_idx on public.lead_stage_history(lead_id, changed_at desc);

create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  activity_type text not null,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references public.users(id) on delete set null,
  summary text not null,
  details text,
  metadata jsonb not null default '{}'::jsonb,
  constraint lead_activities_type_check check (
    activity_type in (
      'email_sent',
      'email_received',
      'phone_call_made',
      'viewing_scheduled',
      'viewing_completed',
      'note_added',
      'stage_changed',
      'offer_sent',
      'document_shared'
    )
  )
);

create index if not exists lead_activities_lead_idx on public.lead_activities(lead_id, occurred_at desc);

-- Optional owner-specific pipeline settings.
create table if not exists public.crm_pipeline_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  contact_slug text unique,
  inbound_email text,
  custom_stages jsonb,
  auto_assign_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_pipeline_settings_slug_format check (
    contact_slug is null or contact_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  )
);

create unique index if not exists crm_pipeline_settings_inbound_email_uq
  on public.crm_pipeline_settings (lower(inbound_email))
  where inbound_email is not null;

drop trigger if exists trg_crm_pipeline_settings_touch on public.crm_pipeline_settings;
create trigger trg_crm_pipeline_settings_touch
before update on public.crm_pipeline_settings
for each row execute procedure public.touch_updated_at();

-- Keep updated_at current.
drop trigger if exists trg_leads_touch on public.leads;
create trigger trg_leads_touch
before update on public.leads
for each row execute procedure public.touch_updated_at();

-- Auto-stage-history + stage-change activity.
create or replace function public.leads_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lead_stage_history (
    lead_id, from_stage, to_stage, changed_by_user_id, changed_at, notes, assigned_agent_user_id, next_action, next_action_date, lost_reason
  )
  values (
    new.id, null, new.stage, coalesce(new.created_by_user_id, auth.uid()), coalesce(new.stage_changed_at, now()),
    new.stage_notes, new.assigned_agent_user_id, new.next_action, new.next_action_date, new.lost_reason
  );

  insert into public.lead_activities (lead_id, activity_type, actor_user_id, summary, details)
  values (
    new.id, 'stage_changed', coalesce(new.created_by_user_id, auth.uid()),
    'Lead created', format('Initial stage: %s', new.stage)
  );

  return new;
end;
$$;

drop trigger if exists trg_leads_after_insert on public.leads;
create trigger trg_leads_after_insert
after insert on public.leads
for each row execute procedure public.leads_after_insert();

create or replace function public.leads_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := coalesce(auth.uid(), new.created_by_user_id, old.created_by_user_id);

  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();

    insert into public.lead_stage_history (
      lead_id, from_stage, to_stage, changed_by_user_id, changed_at, notes, assigned_agent_user_id, next_action, next_action_date, lost_reason
    )
    values (
      new.id, old.stage, new.stage, v_actor, now(),
      new.stage_notes, new.assigned_agent_user_id, new.next_action, new.next_action_date, new.lost_reason
    );

    insert into public.lead_activities (lead_id, activity_type, actor_user_id, summary, details)
    values (
      new.id, 'stage_changed', v_actor,
      format('Stage changed to %s', new.stage),
      coalesce(new.stage_notes, '')
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_leads_after_update on public.leads;
create trigger trg_leads_after_update
after update on public.leads
for each row execute procedure public.leads_after_update();

-- ---- RLS ----
alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
alter table public.lead_stage_history enable row level security;
alter table public.crm_pipeline_settings enable row level security;

-- Helper notes:
-- super_admin: all rows
-- owner/manager: all leads in their tenant(s)
-- customer_service: read-only in their tenant(s)
-- agent: only assigned leads

drop policy if exists "leads_select" on public.leads;
create policy "leads_select"
on public.leads
for select
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or (
    leads.pipeline_owner = 'platform'
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and lower(m.role) = 'manager'
    )
  )
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = leads.tenant_id
      and leads.pipeline_owner = leads.tenant_id::text
      and lower(m.role) in ('owner', 'manager', 'customer_service', 'viewer', 'accounting', 'maintenance')
  )
  or leads.assigned_agent_user_id = auth.uid()
);

drop policy if exists "leads_insert" on public.leads;
create policy "leads_insert"
on public.leads
for insert
to authenticated
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or (
    leads.pipeline_owner = 'platform'
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and lower(m.role) = 'manager'
    )
  )
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = leads.tenant_id
      and leads.pipeline_owner = leads.tenant_id::text
      and lower(m.role) in ('owner', 'manager')
  )
  or (
    leads.assigned_agent_user_id = auth.uid()
    and leads.pipeline_owner = leads.tenant_id::text
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = leads.tenant_id
        and lower(m.role) = 'agent'
    )
  )
);

drop policy if exists "leads_update" on public.leads;
create policy "leads_update"
on public.leads
for update
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or (
    leads.pipeline_owner = 'platform'
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and lower(m.role) = 'manager'
    )
  )
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = leads.tenant_id
      and leads.pipeline_owner = leads.tenant_id::text
      and lower(m.role) in ('owner', 'manager')
  )
  or (
    leads.assigned_agent_user_id = auth.uid()
    and leads.pipeline_owner = leads.tenant_id::text
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = leads.tenant_id
        and lower(m.role) = 'agent'
    )
  )
)
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or (
    leads.pipeline_owner = 'platform'
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and lower(m.role) = 'manager'
    )
  )
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = leads.tenant_id
      and leads.pipeline_owner = leads.tenant_id::text
      and lower(m.role) in ('owner', 'manager')
  )
  or (
    leads.assigned_agent_user_id = auth.uid()
    and leads.pipeline_owner = leads.tenant_id::text
    and exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = leads.tenant_id
        and lower(m.role) = 'agent'
    )
  )
);

drop policy if exists "lead_activities_select" on public.lead_activities;
create policy "lead_activities_select"
on public.lead_activities
for select
to authenticated
using (
  exists (
    select 1 from public.leads l
    where l.id = lead_activities.lead_id
      and (
        exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
        or exists (
          select 1 from public.memberships m
          where m.user_id = auth.uid()
            and m.tenant_id = l.tenant_id
            and lower(m.role) in ('owner', 'manager', 'customer_service', 'viewer', 'accounting', 'maintenance')
        )
        or l.assigned_agent_user_id = auth.uid()
      )
  )
);

drop policy if exists "lead_activities_write" on public.lead_activities;
create policy "lead_activities_write"
on public.lead_activities
for all
to authenticated
using (
  exists (
    select 1 from public.leads l
    where l.id = lead_activities.lead_id
      and (
        exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
        or exists (
          select 1 from public.memberships m
          where m.user_id = auth.uid()
            and m.tenant_id = l.tenant_id
            and lower(m.role) in ('owner', 'manager')
        )
        or (
          l.assigned_agent_user_id = auth.uid()
          and exists (
            select 1 from public.memberships m
            where m.user_id = auth.uid()
              and m.tenant_id = l.tenant_id
              and lower(m.role) = 'agent'
          )
        )
      )
  )
)
with check (true);

drop policy if exists "crm_pipeline_settings_select" on public.crm_pipeline_settings;
create policy "crm_pipeline_settings_select"
on public.crm_pipeline_settings
for select
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = crm_pipeline_settings.tenant_id
      and lower(m.role) in ('owner', 'manager', 'customer_service', 'viewer')
  )
);

drop policy if exists "crm_pipeline_settings_write" on public.crm_pipeline_settings;
create policy "crm_pipeline_settings_write"
on public.crm_pipeline_settings
for all
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = crm_pipeline_settings.tenant_id
      and lower(m.role) in ('owner', 'manager')
  )
)
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = crm_pipeline_settings.tenant_id
      and lower(m.role) in ('owner', 'manager')
  )
);

drop policy if exists "lead_stage_history_select" on public.lead_stage_history;
create policy "lead_stage_history_select"
on public.lead_stage_history
for select
to authenticated
using (
  exists (
    select 1 from public.leads l
    where l.id = lead_stage_history.lead_id
      and (
        exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
        or exists (
          select 1 from public.memberships m
          where m.user_id = auth.uid()
            and m.tenant_id = l.tenant_id
            and lower(m.role) in ('owner', 'manager', 'customer_service', 'viewer', 'accounting', 'maintenance')
        )
        or l.assigned_agent_user_id = auth.uid()
      )
  )
);

-- Stage history rows are normally created by trigger, but keep explicit write for staff.
drop policy if exists "lead_stage_history_write" on public.lead_stage_history;
create policy "lead_stage_history_write"
on public.lead_stage_history
for all
to authenticated
using (
  exists (
    select 1 from public.leads l
    where l.id = lead_stage_history.lead_id
      and (
        exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
        or exists (
          select 1 from public.memberships m
          where m.user_id = auth.uid()
            and m.tenant_id = l.tenant_id
            and lower(m.role) in ('owner', 'manager')
        )
      )
  )
)
with check (true);

comment on table public.leads is 'CRM leads + current pipeline state.';
comment on table public.lead_activities is 'Activity timeline for each lead.';
comment on table public.lead_stage_history is 'History of stage transitions per lead.';
comment on table public.crm_pipeline_settings is 'Optional owner-level pipeline configuration (disabled by default).';

