-- =====================================================================
-- Bookable spaces + reservations (bookings)
-- Run in Supabase SQL Editor AFTER the core schema from README.md exists.
-- See README section "Bookable spaces & bookings (SQL)".
-- =====================================================================

-- ---- bookable_spaces -------------------------------------------------
create table if not exists public.bookable_spaces (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  space_type text not null,
  capacity integer not null default 1,
  floor text,
  room_number text,
  hourly_price numeric(12, 2) not null default 0,
  requires_approval boolean not null default false,
  space_status text not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookable_spaces_space_type_check check (
    space_type in ('meeting_room', 'office', 'desk', 'hot_desk')
  ),
  constraint bookable_spaces_status_check check (
    space_status in ('available', 'unavailable', 'under_maintenance')
  ),
  constraint bookable_spaces_capacity_positive check (capacity >= 1),
  constraint bookable_spaces_hourly_price_nonneg check (hourly_price >= 0)
);

create index if not exists bookable_spaces_property_id_idx
  on public.bookable_spaces (property_id);

alter table public.bookable_spaces
  add column if not exists is_published boolean not null default true;

-- ---- bookings --------------------------------------------------------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.bookable_spaces(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  booker_type text not null,
  booker_user_id uuid references public.users(id) on delete set null,
  visitor_name text,
  visitor_email text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  purpose text,
  attendee_count integer not null default 1,
  status text not null default 'pending',
  deposit_paid boolean not null default false,
  payment_made boolean not null default false,
  total_price numeric(12, 2) not null default 0,
  rejection_reason text,
  public_access_token uuid not null default gen_random_uuid() unique,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_booker_type_check check (
    booker_type in ('registered_user', 'visitor')
  ),
  constraint bookings_status_check check (
    status in ('pending', 'confirmed', 'rejected', 'cancelled')
  ),
  constraint bookings_time_order check (end_at > start_at),
  constraint bookings_attendees_positive check (attendee_count >= 1),
  constraint bookings_visitor_fields check (
    (booker_type = 'visitor' and visitor_name is not null and visitor_email is not null and booker_user_id is null)
    or
    (booker_type = 'registered_user' and booker_user_id is not null and visitor_name is null and visitor_email is null)
  )
);

create index if not exists bookings_space_id_idx on public.bookings (space_id);
create index if not exists bookings_tenant_id_idx on public.bookings (tenant_id);
create index if not exists bookings_property_id_idx on public.bookings (property_id);
create index if not exists bookings_start_at_idx on public.bookings (start_at);

-- No overlapping pending/confirmed bookings on the same space.
create or replace function public.prevent_booking_overlap()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('cancelled', 'rejected') then
    return new;
  end if;
  if exists (
    select 1
    from public.bookings b
    where b.space_id = new.space_id
      and b.id is distinct from new.id
      and b.status in ('pending', 'confirmed')
      and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(new.start_at, new.end_at, '[)')
  ) then
    raise exception 'This space is already booked for that time range';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bookings_overlap on public.bookings;
create trigger trg_bookings_overlap
before insert or update of space_id, start_at, end_at, status
on public.bookings
for each row
execute procedure public.prevent_booking_overlap();

-- Before insert: copy tenant/property from space, enforce availability, compute price, set pending vs confirmed.
create or replace function public.bookings_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_id uuid;
  v_tenant_id uuid;
  v_requires boolean;
  v_hourly numeric;
  v_space_status text;
  v_space_type text;
  v_hours numeric;
  v_published boolean;
begin
  select
    bs.property_id,
    p.tenant_id,
    bs.requires_approval,
    bs.hourly_price,
    bs.space_status,
    bs.space_type,
    coalesce(bs.is_published, true)
  into
    v_property_id,
    v_tenant_id,
    v_requires,
    v_hourly,
    v_space_status,
    v_space_type,
    v_published
  from public.bookable_spaces bs
  join public.properties p on p.id = bs.property_id
  where bs.id = new.space_id;

  if v_property_id is null then
    raise exception 'Invalid space_id';
  end if;

  if v_space_status is null
     or lower(trim(v_space_status)) not in ('available', 'vacant') then
    raise exception 'Space is not available for booking';
  end if;

  if v_published is not true then
    raise exception 'Space is not published for booking';
  end if;

  if v_space_type = 'office' then
    raise exception 'Offices use long-term leases; use the rooms dashboard for lease details, not hourly booking';
  end if;

  new.property_id := v_property_id;
  new.tenant_id := v_tenant_id;

  v_hours := greatest(
    extract(epoch from (new.end_at - new.start_at)) / 3600.0,
    0
  );
  new.total_price := round((v_hourly * v_hours)::numeric, 2);

  if v_requires then
    new.status := 'pending';
  else
    new.status := 'confirmed';
  end if;

  if new.created_by_user_id is null and auth.uid() is not null then
    new.created_by_user_id := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bookings_before_insert on public.bookings;
create trigger trg_bookings_before_insert
before insert on public.bookings
for each row
execute procedure public.bookings_before_insert();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_bookable_spaces_touch on public.bookable_spaces;
create trigger trg_bookable_spaces_touch
before update on public.bookable_spaces
for each row
execute procedure public.touch_updated_at();

drop trigger if exists trg_bookings_touch on public.bookings;
create trigger trg_bookings_touch
before update on public.bookings
for each row
execute procedure public.touch_updated_at();

-- ---- RLS -------------------------------------------------------------
alter table public.bookable_spaces enable row level security;
alter table public.bookings enable row level security;

-- bookable_spaces: read for anyone in the tenant (incl. tenant renter, CS, accounting, maintenance) + super_admin
drop policy if exists "bookable_spaces_select" on public.bookable_spaces;
create policy "bookable_spaces_select"
on public.bookable_spaces
for select
to authenticated
using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and lower(m.role) = 'super_admin'
  )
  or exists (
    select 1
    from public.properties p
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = auth.uid()
    where p.id = bookable_spaces.property_id
      and lower(m.role) in (
        'owner', 'manager', 'viewer', 'customer_service',
        'accounting', 'maintenance', 'tenant'
      )
  )
);

-- Visitor booking UI (anon): only list available spaces (narrow further in API later if needed)
drop policy if exists "bookable_spaces_select_anon" on public.bookable_spaces;
create policy "bookable_spaces_select_anon"
on public.bookable_spaces
for select
to anon
using (space_status = 'available');

drop policy if exists "bookable_spaces_write_staff" on public.bookable_spaces;
create policy "bookable_spaces_write_staff"
on public.bookable_spaces
for all
to authenticated
using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and lower(m.role) = 'super_admin'
  )
  or exists (
    select 1
    from public.properties p
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = auth.uid()
    where p.id = bookable_spaces.property_id
      and lower(m.role) in ('owner', 'manager')
  )
)
with check (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and lower(m.role) = 'super_admin'
  )
  or exists (
    select 1
    from public.properties p
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = auth.uid()
    where p.id = bookable_spaces.property_id
      and lower(m.role) in ('owner', 'manager')
  )
);

-- bookings: read
drop policy if exists "bookings_select_authenticated" on public.bookings;
create policy "bookings_select_authenticated"
on public.bookings
for select
to authenticated
using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and lower(m.role) = 'super_admin'
  )
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = bookings.tenant_id
      and lower(m.role) in (
        'owner', 'manager', 'customer_service', 'accounting',
        'maintenance', 'viewer'
      )
  )
  or (
    bookings.booker_type = 'registered_user'
    and bookings.booker_user_id = auth.uid()
  )
  or (bookings.created_by_user_id = auth.uid())
);

-- Public success pages: recommend Next.js server + service role; no anon SELECT on bookings by default.

-- bookings: insert (logged-in)
drop policy if exists "bookings_insert_authenticated" on public.bookings;
create policy "bookings_insert_authenticated"
on public.bookings
for insert
to authenticated
with check (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and lower(m.role) = 'super_admin'
  )
  or exists (
    select 1
    from public.bookable_spaces bs
    join public.properties p on p.id = bs.property_id
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = auth.uid()
    where bs.id = bookings.space_id
      and lower(m.role) in ('owner', 'manager')
  )
  or (
    bookings.booker_type = 'registered_user'
    and bookings.booker_user_id = auth.uid()
    and exists (
      select 1
      from public.bookable_spaces bs
      join public.properties p on p.id = bs.property_id
      join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = auth.uid()
      where bs.id = bookings.space_id
        and lower(m.role) = 'tenant'
    )
  )
);

-- bookings: insert (outside visitor, no account)
drop policy if exists "bookings_insert_visitor_anon" on public.bookings;
create policy "bookings_insert_visitor_anon"
on public.bookings
for insert
to anon
with check (
  booker_type = 'visitor'
  and visitor_name is not null
  and visitor_email is not null
  and booker_user_id is null
  and created_by_user_id is null
);

-- bookings: update — staff (approve/reject/cancel) or registered booker (e.g. cancel)
drop policy if exists "bookings_update" on public.bookings;
create policy "bookings_update"
on public.bookings
for update
to authenticated
using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and lower(m.role) = 'super_admin'
  )
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = bookings.tenant_id
      and lower(m.role) in ('owner', 'manager')
  )
  or (
    bookings.booker_type = 'registered_user'
    and bookings.booker_user_id = auth.uid()
  )
)
with check (true);

-- Extend properties SELECT so tenant + customer_service can see buildings (booking UIs)
drop policy if exists "Property read - owner" on public.properties;
create policy "Property read - owner"
on public.properties
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and lower(m.role) = 'super_admin'
  )
  or (
    exists (
      select 1
      from public.memberships m
      where m.tenant_id = properties.tenant_id
        and m.user_id = auth.uid()
        and lower(m.role) in (
          'owner', 'manager', 'viewer',
          'tenant', 'customer_service',
          'accounting', 'maintenance'
        )
    )
  )
);

comment on table public.bookable_spaces is 'Rentable spaces per property (rooms, desks, offices).';
comment on table public.bookings is 'Reservations; overlap enforced for pending/confirmed; price/status set on insert.';
