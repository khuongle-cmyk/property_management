-- =====================================================================
-- Proposals, contracts, additional services, lease invoices
-- Run AFTER core schema (README) + bookable_spaces_and_bookings.sql
-- + rooms_management_upgrade.sql (bookable_spaces must exist).
--
-- Naming: uses lease_invoices (not public.invoices) so this does not
-- collide with the legacy invoices table from the README starter schema.
-- Future UI can treat lease_invoices as "contract invoices".
-- =====================================================================

create extension if not exists pgcrypto;

-- ---- room_proposals (one open proposal per room: draft or sent) ----
create table if not exists public.room_proposals (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.bookable_spaces(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  tenant_company_name text not null,
  contact_person text not null,
  proposed_rent numeric(12, 2) not null,
  proposed_start_date date not null,
  valid_until date not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_proposals_status_check check (
    status in ('draft', 'sent', 'accepted', 'rejected')
  ),
  constraint room_proposals_rent_nonneg check (proposed_rent >= 0)
);

create index if not exists room_proposals_room_id_idx on public.room_proposals (room_id);
create index if not exists room_proposals_property_id_idx on public.room_proposals (property_id);
create index if not exists room_proposals_status_idx on public.room_proposals (status);

-- At most one non-terminal proposal per room (draft or sent).
create unique index if not exists room_proposals_one_open_per_room_idx
  on public.room_proposals (room_id)
  where status in ('draft', 'sent');

-- ---- room_contracts (one active contract per room) ----
create table if not exists public.room_contracts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.bookable_spaces(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  monthly_rent numeric(12, 2) not null,
  start_date date not null,
  end_date date,
  deposit_amount numeric(12, 2),
  status text not null default 'draft',
  signed_date date,
  source_proposal_id uuid references public.room_proposals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_contracts_status_check check (
    status in ('draft', 'active', 'expired', 'terminated', 'cancelled')
  ),
  constraint room_contracts_rent_nonneg check (monthly_rent >= 0),
  constraint room_contracts_deposit_nonneg check (deposit_amount is null or deposit_amount >= 0)
);

create index if not exists room_contracts_room_id_idx on public.room_contracts (room_id);
create index if not exists room_contracts_property_id_idx on public.room_contracts (property_id);
create index if not exists room_contracts_tenant_id_idx on public.room_contracts (tenant_id);
create index if not exists room_contracts_status_idx on public.room_contracts (status);
create index if not exists room_contracts_proposal_idx on public.room_contracts (source_proposal_id);

create unique index if not exists room_contracts_one_active_per_room_idx
  on public.room_contracts (room_id)
  where status = 'active';

-- ---- lease_invoices (monthly billing; one row per contract per billing month) ----
create table if not exists public.lease_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.room_contracts(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete cascade,
  billing_month date not null,
  base_rent numeric(12, 2) not null default 0,
  additional_services_total numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) not null default 0,
  status text not null default 'draft',
  due_date date not null,
  paid_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lease_invoices_status_check check (
    status in ('draft', 'sent', 'paid', 'overdue')
  ),
  constraint lease_invoices_amounts_nonneg check (
    base_rent >= 0 and additional_services_total >= 0 and total_amount >= 0
  ),
  constraint lease_invoices_billing_month_first_day check (billing_month = date_trunc('month', billing_month)::date)
);

create index if not exists lease_invoices_contract_idx on public.lease_invoices (contract_id);
create index if not exists lease_invoices_tenant_idx on public.lease_invoices (tenant_id);
create index if not exists lease_invoices_property_idx on public.lease_invoices (property_id);
create index if not exists lease_invoices_month_idx on public.lease_invoices (billing_month);
create index if not exists lease_invoices_status_idx on public.lease_invoices (status);

create unique index if not exists lease_invoices_contract_month_uidx
  on public.lease_invoices (contract_id, billing_month);

-- ---- additional_services (per-use add-ons; roll into monthly invoice) ----
create table if not exists public.additional_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  service_name text not null,
  pricing_type text not null default 'per_use',
  unit_price numeric(12, 2) not null,
  quantity_used numeric(14, 4) not null default 0,
  billing_month date not null,
  invoice_id uuid references public.lease_invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint additional_services_service_name_check check (
    service_name in (
      'parking',
      'storage',
      'cleaning',
      'it',
      'kitchen',
      'meeting_credits',
      'reception',
      'other'
    )
  ),
  constraint additional_services_pricing_type_check check (pricing_type = 'per_use'),
  constraint additional_services_unit_price_nonneg check (unit_price >= 0),
  constraint additional_services_quantity_nonneg check (quantity_used >= 0),
  constraint additional_services_billing_month_first_day check (billing_month = date_trunc('month', billing_month)::date)
);

create index if not exists additional_services_tenant_idx on public.additional_services (tenant_id);
create index if not exists additional_services_property_idx on public.additional_services (property_id);
create index if not exists additional_services_month_idx on public.additional_services (billing_month);
create index if not exists additional_services_invoice_idx on public.additional_services (invoice_id);

-- Triggers: updated_at
drop trigger if exists trg_room_proposals_touch on public.room_proposals;
create trigger trg_room_proposals_touch
before update on public.room_proposals
for each row execute procedure public.touch_updated_at();

drop trigger if exists trg_room_contracts_touch on public.room_contracts;
create trigger trg_room_contracts_touch
before update on public.room_contracts
for each row execute procedure public.touch_updated_at();

drop trigger if exists trg_lease_invoices_touch on public.lease_invoices;
create trigger trg_lease_invoices_touch
before update on public.lease_invoices
for each row execute procedure public.touch_updated_at();

drop trigger if exists trg_additional_services_touch on public.additional_services;
create trigger trg_additional_services_touch
before update on public.additional_services
for each row execute procedure public.touch_updated_at();

-- ---- RLS ----
alter table public.room_proposals enable row level security;
alter table public.room_contracts enable row level security;
alter table public.lease_invoices enable row level security;
alter table public.additional_services enable row level security;

-- Helper pattern: staff on properties.tenant_id matching row tenant_id / property
-- Financial tables: no customer_service (align with legacy README invoices).

-- room_proposals: read (staff + viewer + accounting), write owner/manager/super_admin
drop policy if exists "room_proposals_select" on public.room_proposals;
create policy "room_proposals_select"
on public.room_proposals
for select
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = (
        select p.tenant_id from public.properties p where p.id = room_proposals.property_id
      )
      and lower(m.role) in (
        'owner', 'manager', 'viewer', 'accounting', 'maintenance'
      )
  )
);

drop policy if exists "room_proposals_write" on public.room_proposals;
create policy "room_proposals_write"
on public.room_proposals
for all
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = (
        select p.tenant_id from public.properties p where p.id = room_proposals.property_id
      )
      and lower(m.role) in ('owner', 'manager')
  )
)
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = (
        select p.tenant_id from public.properties p where p.id = room_proposals.property_id
      )
      and lower(m.role) in ('owner', 'manager')
  )
);

-- room_contracts
drop policy if exists "room_contracts_select" on public.room_contracts;
create policy "room_contracts_select"
on public.room_contracts
for select
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = room_contracts.tenant_id
      and lower(m.role) in (
        'owner', 'manager', 'viewer', 'accounting', 'maintenance'
      )
  )
);

drop policy if exists "room_contracts_write" on public.room_contracts;
create policy "room_contracts_write"
on public.room_contracts
for all
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = room_contracts.tenant_id
      and lower(m.role) in ('owner', 'manager', 'accounting')
  )
)
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = room_contracts.tenant_id
      and lower(m.role) in ('owner', 'manager', 'accounting')
  )
);

-- lease_invoices (align read access with README legacy invoices: accounting + viewer; no customer_service)
drop policy if exists "lease_invoices_select" on public.lease_invoices;
create policy "lease_invoices_select"
on public.lease_invoices
for select
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = lease_invoices.tenant_id
      and lower(m.role) in ('owner', 'manager', 'accounting', 'viewer')
  )
);

drop policy if exists "lease_invoices_write" on public.lease_invoices;
create policy "lease_invoices_write"
on public.lease_invoices
for all
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = lease_invoices.tenant_id
      and lower(m.role) in ('owner', 'manager', 'accounting')
  )
)
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = lease_invoices.tenant_id
      and lower(m.role) in ('owner', 'manager', 'accounting')
  )
);

-- additional_services
drop policy if exists "additional_services_select" on public.additional_services;
create policy "additional_services_select"
on public.additional_services
for select
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = additional_services.tenant_id
      and lower(m.role) in (
        'owner', 'manager', 'viewer', 'accounting', 'maintenance'
      )
  )
);

drop policy if exists "additional_services_write" on public.additional_services;
create policy "additional_services_write"
on public.additional_services
for all
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = additional_services.tenant_id
      and lower(m.role) in ('owner', 'manager', 'accounting')
  )
)
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = additional_services.tenant_id
      and lower(m.role) in ('owner', 'manager', 'accounting')
  )
);

comment on table public.room_proposals is
  'Lease/proposal for a bookable space; at most one draft/sent per room. On acceptance, create room_contracts and set proposal status to accepted.';
comment on table public.room_contracts is
  'Active lease for a room; at most one active contract per room. tenant_id is the landlord org (properties.tenant_id). Use application logic or jobs to generate lease_invoices monthly.';
comment on table public.additional_services is
  'Per-use add-ons per property and billing month; link to lease_invoices via invoice_id when included in a bill.';
comment on table public.lease_invoices is
  'Monthly rent invoice for a room contract. Unique (contract_id, billing_month). Legacy README invoices table is separate.';
