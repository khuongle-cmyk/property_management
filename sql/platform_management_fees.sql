-- Platform management fee (charged by the platform to each tenant / property).
-- Run in Supabase SQL editor after tenants/properties exist.

create table if not exists public.platform_management_fees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  property_id uuid references public.properties (id) on delete cascade,
  year int not null check (year >= 2000 and year <= 2100),
  month int not null check (month >= 1 and month <= 12),
  amount_eur numeric(14, 2) not null check (amount_eur >= 0),
  calculation_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists platform_management_fees_prop_month_uq
  on public.platform_management_fees (tenant_id, property_id, year, month)
  where property_id is not null;

create unique index if not exists platform_management_fees_portfolio_month_uq
  on public.platform_management_fees (tenant_id, year, month)
  where property_id is null;

create index if not exists platform_management_fees_tenant_id_idx
  on public.platform_management_fees (tenant_id);

alter table public.platform_management_fees enable row level security;

-- Super admins: full access
drop policy if exists platform_management_fees_super_admin_all on public.platform_management_fees;
create policy platform_management_fees_super_admin_all on public.platform_management_fees
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- Tenant staff: read amounts for reporting (no writes)
drop policy if exists platform_management_fees_tenant_select on public.platform_management_fees;
create policy platform_management_fees_tenant_select on public.platform_management_fees
  for select
  using (
    exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = platform_management_fees.tenant_id
        and lower(coalesce(m.role, '')) in (
          'owner',
          'manager',
          'customer_service',
          'accounting',
          'viewer',
          'super_admin'
        )
    )
  );

comment on table public.platform_management_fees is
  'Platform management fee per tenant month; property_id null = portfolio-wide (allocated in app by revenue share).';
