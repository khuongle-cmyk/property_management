-- =====================================================================
-- Customer companies + portal users (links CRM leads via customer_company_id)
-- Run in Supabase SQL Editor after tenants, properties, users, leads exist.
-- =====================================================================

create table if not exists public.customer_companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  name text not null,
  business_id text,
  email text,
  phone text,
  address_line text,
  city text,
  postal_code text,
  industry text,
  company_size text,
  space_type text,
  contract_start date,
  contract_end date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_companies_tenant_idx on public.customer_companies(tenant_id);
create index if not exists customer_companies_property_idx on public.customer_companies(property_id);
create index if not exists customer_companies_name_lc_idx on public.customer_companies(lower(name));

create table if not exists public.customer_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.customer_companies(id) on delete cascade,
  auth_user_id uuid references public.users(id) on delete set null,
  first_name text,
  last_name text,
  email text not null,
  phone text,
  role text not null default 'employee' check (role in ('company_admin', 'employee')),
  status text not null default 'invited' check (status in ('invited', 'active', 'inactive')),
  invited_at timestamptz not null default now(),
  invited_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_users_company_email_lower_uidx
  on public.customer_users(company_id, lower(email));

create index if not exists customer_users_company_idx on public.customer_users(company_id);
create index if not exists customer_users_auth_idx on public.customer_users(auth_user_id);

alter table public.leads
  add column if not exists customer_company_id uuid references public.customer_companies(id) on delete set null;

create index if not exists leads_customer_company_idx on public.leads(customer_company_id) where customer_company_id is not null;

-- Touch updated_at
create or replace function public.touch_customer_companies_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists trg_customer_companies_touch on public.customer_companies;
create trigger trg_customer_companies_touch
before update on public.customer_companies
for each row execute function public.touch_customer_companies_updated_at();

create or replace function public.touch_customer_users_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists trg_customer_users_touch on public.customer_users;
create trigger trg_customer_users_touch
before update on public.customer_users
for each row execute function public.touch_customer_users_updated_at();

-- ---- RLS ----------------------------------------------------------------
alter table public.customer_companies enable row level security;
alter table public.customer_users enable row level security;

drop policy if exists "customer_companies_select_super" on public.customer_companies;
create policy "customer_companies_select_super"
on public.customer_companies for select to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
);

drop policy if exists "customer_companies_select_tenant_staff" on public.customer_companies;
create policy "customer_companies_select_tenant_staff"
on public.customer_companies for select to authenticated
using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = customer_companies.tenant_id
      and lower(m.role) in ('owner', 'manager', 'customer_service')
  )
);

drop policy if exists "customer_companies_insert_super" on public.customer_companies;
create policy "customer_companies_insert_super"
on public.customer_companies for insert to authenticated
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
);

drop policy if exists "customer_companies_insert_staff" on public.customer_companies;
create policy "customer_companies_insert_staff"
on public.customer_companies for insert to authenticated
with check (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = customer_companies.tenant_id
      and lower(m.role) in ('owner', 'manager')
  )
);

drop policy if exists "customer_companies_update_super" on public.customer_companies;
create policy "customer_companies_update_super"
on public.customer_companies for update to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
)
with check (true);

drop policy if exists "customer_companies_update_staff" on public.customer_companies;
create policy "customer_companies_update_staff"
on public.customer_companies for update to authenticated
using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = customer_companies.tenant_id
      and lower(m.role) in ('owner', 'manager')
  )
)
with check (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = customer_companies.tenant_id
      and lower(m.role) in ('owner', 'manager')
  )
);

drop policy if exists "customer_companies_delete_super" on public.customer_companies;
create policy "customer_companies_delete_super"
on public.customer_companies for delete to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
);

drop policy if exists "customer_companies_delete_staff" on public.customer_companies;
create policy "customer_companies_delete_staff"
on public.customer_companies for delete to authenticated
using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = customer_companies.tenant_id
      and lower(m.role) in ('owner', 'manager')
  )
);

-- Portal: read own company via customer_users
drop policy if exists "customer_companies_select_portal" on public.customer_companies;
create policy "customer_companies_select_portal"
on public.customer_companies for select to authenticated
using (
  exists (
    select 1 from public.customer_users cu
    where cu.company_id = customer_companies.id
      and cu.auth_user_id = auth.uid()
  )
);

-- customer_users policies
drop policy if exists "customer_users_select_super" on public.customer_users;
create policy "customer_users_select_super"
on public.customer_users for select to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
);

drop policy if exists "customer_users_select_staff" on public.customer_users;
create policy "customer_users_select_staff"
on public.customer_users for select to authenticated
using (
  exists (
    select 1
    from public.customer_companies cc
    join public.memberships m on m.tenant_id = cc.tenant_id and m.user_id = auth.uid()
    where cc.id = customer_users.company_id
      and lower(m.role) in ('owner', 'manager', 'customer_service')
  )
);

drop policy if exists "customer_users_select_self" on public.customer_users;
create policy "customer_users_select_self"
on public.customer_users for select to authenticated
using (customer_users.auth_user_id = auth.uid());

drop policy if exists "customer_users_insert_super" on public.customer_users;
create policy "customer_users_insert_super"
on public.customer_users for insert to authenticated
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
);

drop policy if exists "customer_users_insert_staff" on public.customer_users;
create policy "customer_users_insert_staff"
on public.customer_users for insert to authenticated
with check (
  exists (
    select 1
    from public.customer_companies cc
    join public.memberships m on m.tenant_id = cc.tenant_id and m.user_id = auth.uid()
    where cc.id = customer_users.company_id
      and lower(m.role) in ('owner', 'manager')
  )
);

drop policy if exists "customer_users_update_super" on public.customer_users;
create policy "customer_users_update_super"
on public.customer_users for update to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
)
with check (true);

drop policy if exists "customer_users_update_staff" on public.customer_users;
create policy "customer_users_update_staff"
on public.customer_users for update to authenticated
using (
  exists (
    select 1
    from public.customer_companies cc
    join public.memberships m on m.tenant_id = cc.tenant_id and m.user_id = auth.uid()
    where cc.id = customer_users.company_id
      and lower(m.role) in ('owner', 'manager')
  )
)
with check (
  exists (
    select 1
    from public.customer_companies cc
    join public.memberships m on m.tenant_id = cc.tenant_id and m.user_id = auth.uid()
    where cc.id = customer_users.company_id
      and lower(m.role) in ('owner', 'manager')
  )
);

drop policy if exists "customer_users_delete_super" on public.customer_users;
create policy "customer_users_delete_super"
on public.customer_users for delete to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
);

drop policy if exists "customer_users_delete_staff" on public.customer_users;
create policy "customer_users_delete_staff"
on public.customer_users for delete to authenticated
using (
  exists (
    select 1
    from public.customer_companies cc
    join public.memberships m on m.tenant_id = cc.tenant_id and m.user_id = auth.uid()
    where cc.id = customer_users.company_id
      and lower(m.role) in ('owner', 'manager')
  )
);

comment on table public.customer_companies is 'Customer orgs (portal); optional link from CRM leads.customer_company_id.';
comment on table public.customer_users is 'Portal users employed by a customer company.';
