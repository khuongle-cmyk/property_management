-- Ensure Procountor cost center mappings table + RLS work (fixes 500 on /api/settings/import/procountor-mappings).
-- Safe to run multiple times.

create table if not exists public.procountor_cost_center_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cost_center_code text not null,
  cost_center_name text,
  property_id uuid not null references public.properties(id) on delete cascade,
  data_type text not null check (data_type in ('revenue', 'cost')),
  category text not null,
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, cost_center_code)
);

create index if not exists procountor_cc_map_tenant_idx on public.procountor_cost_center_mappings(tenant_id, cost_center_code);

alter table public.procountor_cost_center_mappings enable row level security;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and lower(coalesce(m.role, '')) = 'super_admin'
  );
$$;

create or replace function public.can_manage_tenant_data(tid uuid)
returns boolean
language sql
stable
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = tid
        and lower(coalesce(m.role,'')) in ('owner','manager')
    );
$$;

drop policy if exists procountor_cc_map_write_super on public.procountor_cost_center_mappings;

drop policy if exists procountor_cc_map_select on public.procountor_cost_center_mappings;
create policy procountor_cc_map_select on public.procountor_cost_center_mappings
for select using (
  public.is_super_admin()
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = procountor_cost_center_mappings.tenant_id
      and lower(coalesce(m.role,'')) in ('owner','manager','customer_service','accounting','viewer','super_admin')
  )
);

drop policy if exists procountor_cc_map_write on public.procountor_cost_center_mappings;
create policy procountor_cc_map_write on public.procountor_cost_center_mappings
for all using (public.can_manage_tenant_data(procountor_cost_center_mappings.tenant_id))
with check (public.can_manage_tenant_data(procountor_cost_center_mappings.tenant_id));

-- If this table was created after super_admin_global_access.sql ran, add explicit super-admin policy:
drop policy if exists super_admin_full_access on public.procountor_cost_center_mappings;
create policy super_admin_full_access on public.procountor_cost_center_mappings
for all using (public.is_super_admin()) with check (public.is_super_admin());
