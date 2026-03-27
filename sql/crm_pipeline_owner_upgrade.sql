-- Upgrade script for existing CRM deployments:
-- - adds leads.pipeline_owner
-- - adds crm_pipeline_settings
-- - adjusts lead RLS for separated platform vs tenant pipelines

create extension if not exists pgcrypto;

alter table public.leads
  add column if not exists pipeline_owner text;

update public.leads
set pipeline_owner = coalesce(pipeline_owner, tenant_id::text)
where pipeline_owner is null;

alter table public.leads
  alter column pipeline_owner set default 'platform';

alter table public.leads
  alter column pipeline_owner set not null;

alter table public.leads drop constraint if exists leads_pipeline_owner_check;
alter table public.leads
  add constraint leads_pipeline_owner_check check (
    pipeline_owner = 'platform' or pipeline_owner = tenant_id::text
  );

create index if not exists leads_pipeline_owner_idx on public.leads(pipeline_owner);

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

alter table public.crm_pipeline_settings enable row level security;

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

