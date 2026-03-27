create extension if not exists pgcrypto;

create table if not exists public.virtual_office_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  contact_id uuid references public.leads(id) on delete set null,
  contract_number text not null,
  start_date date not null,
  end_date date,
  monthly_fee numeric(12,2) not null default 0,
  status text not null default 'active' check (status in ('active','cancelled','suspended')),
  includes_address boolean not null default true,
  includes_mail_handling boolean not null default false,
  includes_phone_answering boolean not null default false,
  includes_meeting_room_credits boolean not null default false,
  meeting_room_credits_hours numeric(8,2) not null default 0,
  business_registration_address boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists virtual_office_contracts_contract_no_uq
  on public.virtual_office_contracts(tenant_id, contract_number);
create index if not exists virtual_office_contracts_tenant_idx
  on public.virtual_office_contracts(tenant_id, status);
create index if not exists virtual_office_contracts_property_idx
  on public.virtual_office_contracts(property_id, status);

create table if not exists public.furniture_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  room_id uuid references public.bookable_spaces(id) on delete set null,
  name text not null,
  category text not null check (category in ('chair','desk','table','sofa','cabinet','whiteboard','monitor','other')),
  quantity integer not null default 1 check (quantity >= 0),
  condition text not null default 'good' check (condition in ('new','good','fair','poor')),
  purchase_price numeric(12,2),
  purchase_date date,
  serial_number text,
  notes text,
  status text not null default 'available' check (status in ('available','in_use','sold','disposed')),
  created_at timestamptz not null default now()
);
create index if not exists furniture_items_tenant_idx on public.furniture_items(tenant_id, status);
create index if not exists furniture_items_room_idx on public.furniture_items(room_id);

create table if not exists public.furniture_rentals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  furniture_item_id uuid not null references public.furniture_items(id) on delete cascade,
  contract_id uuid references public.room_contracts(id) on delete set null,
  contact_id uuid references public.leads(id) on delete set null,
  rental_type text not null check (rental_type in ('included','extra_rental','sold')),
  monthly_fee numeric(12,2) not null default 0,
  sale_price numeric(12,2),
  start_date date not null,
  end_date date,
  status text not null default 'active' check (status in ('active','ended')),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists furniture_rentals_tenant_idx on public.furniture_rentals(tenant_id, status);
create index if not exists furniture_rentals_contract_idx on public.furniture_rentals(contract_id, status);

create table if not exists public.contract_amendments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.room_contracts(id) on delete cascade,
  amendment_type text not null check (amendment_type in ('furniture_addition','furniture_removal','manual')),
  effective_date date not null,
  original_monthly_rent numeric(12,2) not null default 0,
  delta_monthly_rent numeric(12,2) not null default 0,
  new_monthly_rent numeric(12,2) not null default 0,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists contract_amendments_contract_idx on public.contract_amendments(contract_id, effective_date desc);

create table if not exists public.lease_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.lease_invoices(id) on delete cascade,
  line_type text not null check (line_type in ('base_rent','furniture','virtual_office','additional_services','meeting_room_overage','other')),
  description text not null,
  amount numeric(12,2) not null default 0,
  reference_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists lease_invoice_lines_invoice_idx on public.lease_invoice_lines(invoice_id);

alter table public.virtual_office_contracts enable row level security;
alter table public.furniture_items enable row level security;
alter table public.furniture_rentals enable row level security;
alter table public.contract_amendments enable row level security;
alter table public.lease_invoice_lines enable row level security;

drop policy if exists vo_select on public.virtual_office_contracts;
create policy vo_select on public.virtual_office_contracts
for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = virtual_office_contracts.tenant_id
      and lower(coalesce(m.role,'')) in ('owner','manager','accounting','viewer','super_admin')
  )
);
drop policy if exists vo_write on public.virtual_office_contracts;
create policy vo_write on public.virtual_office_contracts
for all using (public.can_manage_tenant_data(virtual_office_contracts.tenant_id))
with check (public.can_manage_tenant_data(virtual_office_contracts.tenant_id));

drop policy if exists fi_select on public.furniture_items;
create policy fi_select on public.furniture_items
for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = furniture_items.tenant_id
      and lower(coalesce(m.role,'')) in ('owner','manager','accounting','viewer','maintenance','super_admin')
  )
);
drop policy if exists fi_write on public.furniture_items;
create policy fi_write on public.furniture_items
for all using (public.can_manage_tenant_data(furniture_items.tenant_id))
with check (public.can_manage_tenant_data(furniture_items.tenant_id));

drop policy if exists fr_select on public.furniture_rentals;
create policy fr_select on public.furniture_rentals
for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = furniture_rentals.tenant_id
      and lower(coalesce(m.role,'')) in ('owner','manager','accounting','viewer','super_admin')
  )
);
drop policy if exists fr_write on public.furniture_rentals;
create policy fr_write on public.furniture_rentals
for all using (public.can_manage_tenant_data(furniture_rentals.tenant_id))
with check (public.can_manage_tenant_data(furniture_rentals.tenant_id));

drop policy if exists ca_select on public.contract_amendments;
create policy ca_select on public.contract_amendments
for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = contract_amendments.tenant_id
      and lower(coalesce(m.role,'')) in ('owner','manager','accounting','viewer','super_admin')
  )
);
drop policy if exists ca_write on public.contract_amendments;
create policy ca_write on public.contract_amendments
for all using (public.can_manage_tenant_data(contract_amendments.tenant_id))
with check (public.can_manage_tenant_data(contract_amendments.tenant_id));

drop policy if exists lil_select on public.lease_invoice_lines;
create policy lil_select on public.lease_invoice_lines
for select using (
  exists (
    select 1
    from public.lease_invoices i
    join public.memberships m on m.tenant_id = i.tenant_id and m.user_id = auth.uid()
    where i.id = lease_invoice_lines.invoice_id
      and lower(coalesce(m.role,'')) in ('owner','manager','accounting','viewer','super_admin')
  )
);
drop policy if exists lil_write on public.lease_invoice_lines;
create policy lil_write on public.lease_invoice_lines
for all using (
  exists (
    select 1
    from public.lease_invoices i
    where i.id = lease_invoice_lines.invoice_id
      and public.can_manage_tenant_data(i.tenant_id)
  )
)
with check (
  exists (
    select 1
    from public.lease_invoices i
    where i.id = lease_invoice_lines.invoice_id
      and public.can_manage_tenant_data(i.tenant_id)
  )
);

alter table public.historical_revenue
  add column if not exists virtual_office_revenue numeric(14,2) not null default 0,
  add column if not exists furniture_revenue numeric(14,2) not null default 0;

