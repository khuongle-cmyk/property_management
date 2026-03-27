-- =====================================================================
-- Property operating costs + recurring templates (for Net Income report)
-- Run in Supabase SQL Editor AFTER core schema + properties + memberships exist.
-- =====================================================================

-- ---- Recurring cost definitions (generate scheduled line items) ----
create table if not exists public.property_recurring_cost_templates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  cost_type text not null,
  description text not null default '',
  amount numeric(12, 2) not null,
  supplier_name text,
  recurring_frequency text not null,
  start_month date not null,
  end_month date,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_recurring_cost_templates_type_check check (
    cost_type in (
      'cleaning',
      'utilities',
      'property_management',
      'insurance',
      'security',
      'it_infrastructure',
      'marketing',
      'staff',
      'one_off'
    )
  ),
  constraint property_recurring_cost_templates_frequency_check check (
    recurring_frequency in ('monthly', 'quarterly', 'yearly')
  ),
  constraint property_recurring_cost_templates_amount_nonneg check (amount >= 0),
  constraint property_recurring_cost_templates_start_month_first_day check (
    start_month = date_trunc('month', start_month)::date
  ),
  constraint property_recurring_cost_templates_end_month_first_day check (
    end_month is null or end_month = date_trunc('month', end_month)::date
  )
);

create index if not exists property_recurring_cost_templates_property_idx
  on public.property_recurring_cost_templates (property_id);

drop trigger if exists trg_property_recurring_cost_templates_touch on public.property_recurring_cost_templates;
create trigger trg_property_recurring_cost_templates_touch
before update on public.property_recurring_cost_templates
for each row execute function public.touch_updated_at();

-- ---- Cost line items (manual, CSV, or generated from recurring template) ----
create table if not exists public.property_cost_entries (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  cost_type text not null,
  description text not null default '',
  amount numeric(12, 2) not null,
  cost_date date not null,
  period_month date not null,
  supplier_name text,
  invoice_number text,
  notes text,
  status text not null default 'confirmed',
  source text not null default 'manual',
  recurring_template_id uuid references public.property_recurring_cost_templates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_cost_entries_type_check check (
    cost_type in (
      'cleaning',
      'utilities',
      'property_management',
      'insurance',
      'security',
      'it_infrastructure',
      'marketing',
      'staff',
      'one_off'
    )
  ),
  constraint property_cost_entries_status_check check (status in ('scheduled', 'confirmed', 'cancelled')),
  constraint property_cost_entries_source_check check (source in ('manual', 'csv', 'recurring')),
  constraint property_cost_entries_amount_nonneg check (amount >= 0),
  constraint property_cost_entries_period_month_first_day check (
    period_month = date_trunc('month', period_month)::date
  )
);

create index if not exists property_cost_entries_property_month_idx
  on public.property_cost_entries (property_id, period_month);

create index if not exists property_cost_entries_template_idx
  on public.property_cost_entries (recurring_template_id);

drop trigger if exists trg_property_cost_entries_touch on public.property_cost_entries;
create trigger trg_property_cost_entries_touch
before update on public.property_cost_entries
for each row execute function public.touch_updated_at();

-- ---- RLS ----
alter table public.property_recurring_cost_templates enable row level security;
alter table public.property_cost_entries enable row level security;

drop policy if exists "property_recurring_cost_templates_select" on public.property_recurring_cost_templates;
create policy "property_recurring_cost_templates_select"
on public.property_recurring_cost_templates
for select
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    join public.properties p on p.id = property_recurring_cost_templates.property_id
    where m.user_id = auth.uid()
      and m.tenant_id = p.tenant_id
      and lower(m.role) in ('owner', 'manager', 'viewer', 'accounting', 'maintenance')
  )
);

drop policy if exists "property_recurring_cost_templates_write" on public.property_recurring_cost_templates;
create policy "property_recurring_cost_templates_write"
on public.property_recurring_cost_templates
for all
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    join public.properties p on p.id = property_recurring_cost_templates.property_id
    where m.user_id = auth.uid()
      and m.tenant_id = p.tenant_id
      and lower(m.role) in ('owner', 'manager', 'accounting')
  )
)
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    join public.properties p on p.id = property_recurring_cost_templates.property_id
    where m.user_id = auth.uid()
      and m.tenant_id = p.tenant_id
      and lower(m.role) in ('owner', 'manager', 'accounting')
  )
);

drop policy if exists "property_cost_entries_select" on public.property_cost_entries;
create policy "property_cost_entries_select"
on public.property_cost_entries
for select
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    join public.properties p on p.id = property_cost_entries.property_id
    where m.user_id = auth.uid()
      and m.tenant_id = p.tenant_id
      and lower(m.role) in ('owner', 'manager', 'viewer', 'accounting', 'maintenance')
  )
);

drop policy if exists "property_cost_entries_write" on public.property_cost_entries;
create policy "property_cost_entries_write"
on public.property_cost_entries
for all
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    join public.properties p on p.id = property_cost_entries.property_id
    where m.user_id = auth.uid()
      and m.tenant_id = p.tenant_id
      and lower(m.role) in ('owner', 'manager', 'accounting')
  )
)
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    join public.properties p on p.id = property_cost_entries.property_id
    where m.user_id = auth.uid()
      and m.tenant_id = p.tenant_id
      and lower(m.role) in ('owner', 'manager', 'accounting')
  )
);
