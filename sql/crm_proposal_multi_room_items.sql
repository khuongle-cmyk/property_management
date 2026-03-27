-- =====================================================================
-- Multi-room proposals: parent room_proposals + room_proposal_items
-- Multi-room contracts: room_contracts + room_contract_items
-- Run after crm_proposals_negotiation_won.sql (or any state that has room_proposals).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---- Proposal line items ------------------------------------------------
create table if not exists public.room_proposal_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.room_proposals(id) on delete cascade,
  space_id uuid not null references public.bookable_spaces(id) on delete cascade,
  proposed_monthly_rent numeric(12, 2),
  proposed_hourly_rate numeric(12, 2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_proposal_items_rent_nonneg check (
    (proposed_monthly_rent is null or proposed_monthly_rent >= 0)
    and (proposed_hourly_rate is null or proposed_hourly_rate >= 0)
  ),
  constraint room_proposal_items_proposal_space_uq unique (proposal_id, space_id)
);

create index if not exists room_proposal_items_proposal_idx on public.room_proposal_items (proposal_id);
create index if not exists room_proposal_items_space_idx on public.room_proposal_items (space_id);

drop trigger if exists trg_room_proposal_items_touch on public.room_proposal_items;
create trigger trg_room_proposal_items_touch
before update on public.room_proposal_items
for each row execute procedure public.touch_updated_at();

-- Migrate legacy single-room proposals into items (run once)
do $$
begin
  if exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'room_proposals' and c.column_name = 'room_id'
  ) then
    insert into public.room_proposal_items (proposal_id, space_id, proposed_monthly_rent, proposed_hourly_rate, notes)
    select rp.id, rp.room_id, rp.proposed_rent, null, null
    from public.room_proposals rp
    where rp.room_id is not null
    and not exists (
      select 1 from public.room_proposal_items i where i.proposal_id = rp.id and i.space_id = rp.room_id
    );
  end if;
end $$;

-- Drop per-room unique index on parent proposals
drop index if exists public.room_proposals_one_open_per_room_idx;

-- Remove single-room columns from parent proposal
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'room_proposals' and column_name = 'room_id'
  ) then
    alter table public.room_proposals drop constraint if exists room_proposals_room_id_fkey;
    alter table public.room_proposals drop column room_id;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'room_proposals' and column_name = 'proposed_rent'
  ) then
    alter table public.room_proposals drop constraint if exists room_proposals_rent_nonneg;
    alter table public.room_proposals drop column proposed_rent;
  end if;
end $$;

comment on table public.room_proposal_items is 'Line items: one proposal bundles many spaces with per-room pricing.';

-- ---- Contract line items ---------------------------------------------------
create table if not exists public.room_contract_items (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.room_contracts(id) on delete cascade,
  space_id uuid not null references public.bookable_spaces(id) on delete restrict,
  monthly_rent numeric(12, 2) not null default 0,
  hourly_rate numeric(12, 2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_contract_items_amounts_nonneg check (
    monthly_rent >= 0 and (hourly_rate is null or hourly_rate >= 0)
  ),
  constraint room_contract_items_contract_space_uq unique (contract_id, space_id)
);

create index if not exists room_contract_items_contract_idx on public.room_contract_items (contract_id);
create index if not exists room_contract_items_space_idx on public.room_contract_items (space_id);

drop trigger if exists trg_room_contract_items_touch on public.room_contract_items;
create trigger trg_room_contract_items_touch
before update on public.room_contract_items
for each row execute procedure public.touch_updated_at();

-- Backfill contract items from legacy room_id / monthly_rent
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'room_contracts' and column_name = 'room_id'
  ) then
    insert into public.room_contract_items (contract_id, space_id, monthly_rent, hourly_rate, notes)
    select c.id, c.room_id, c.monthly_rent, null, null
    from public.room_contracts c
    where c.room_id is not null
    and not exists (select 1 from public.room_contract_items i where i.contract_id = c.id and i.space_id = c.room_id);
  end if;
end $$;

-- Legacy: one active contract per room was enforced on room_contracts.room_id.
-- Multi-room contracts use items; drop index that blocked multiple nulls poorly.
drop index if exists public.room_contracts_one_active_per_room_idx;

alter table public.room_contracts alter column room_id drop not null;

comment on table public.room_contract_items is 'Spaces and recurring rent components covered by one lease contract; lease_invoices.base_rent aligns with sum(monthly_rent) here.';

-- ---- RLS: proposal items ----------------------------------------------------
alter table public.room_proposal_items enable row level security;

drop policy if exists "room_proposal_items_select" on public.room_proposal_items;
create policy "room_proposal_items_select"
on public.room_proposal_items
for select
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1
    from public.room_proposals p
    join public.properties pr on pr.id = p.property_id
    join public.memberships m on m.tenant_id = pr.tenant_id and m.user_id = auth.uid()
    where p.id = room_proposal_items.proposal_id
      and lower(m.role) in ('owner', 'manager', 'viewer', 'accounting', 'maintenance')
  )
);

drop policy if exists "room_proposal_items_write" on public.room_proposal_items;
create policy "room_proposal_items_write"
on public.room_proposal_items
for all
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1
    from public.room_proposals p
    join public.properties pr on pr.id = p.property_id
    join public.memberships m on m.tenant_id = pr.tenant_id and m.user_id = auth.uid()
    where p.id = room_proposal_items.proposal_id
      and lower(m.role) in ('owner', 'manager')
  )
)
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1
    from public.room_proposals p
    join public.properties pr on pr.id = p.property_id
    join public.memberships m on m.tenant_id = pr.tenant_id and m.user_id = auth.uid()
    where p.id = room_proposal_items.proposal_id
      and lower(m.role) in ('owner', 'manager')
  )
);

-- ---- RLS: contract items ----------------------------------------------------
alter table public.room_contract_items enable row level security;

drop policy if exists "room_contract_items_select" on public.room_contract_items;
create policy "room_contract_items_select"
on public.room_contract_items
for select
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1
    from public.room_contracts c
    join public.properties pr on pr.id = c.property_id
    join public.memberships m on m.tenant_id = pr.tenant_id and m.user_id = auth.uid()
    where c.id = room_contract_items.contract_id
      and lower(m.role) in ('owner', 'manager', 'viewer', 'accounting', 'maintenance')
  )
);

drop policy if exists "room_contract_items_write" on public.room_contract_items;
create policy "room_contract_items_write"
on public.room_contract_items
for all
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1
    from public.room_contracts c
    join public.properties pr on pr.id = c.property_id
    join public.memberships m on m.tenant_id = pr.tenant_id and m.user_id = auth.uid()
    where c.id = room_contract_items.contract_id
      and lower(m.role) in ('owner', 'manager', 'accounting')
  )
)
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1
    from public.room_contracts c
    join public.properties pr on pr.id = c.property_id
    join public.memberships m on m.tenant_id = pr.tenant_id and m.user_id = auth.uid()
    where c.id = room_contract_items.contract_id
      and lower(m.role) in ('owner', 'manager', 'accounting')
  )
);
