-- =====================================================================
-- Rooms management: extend bookable_spaces, combinations, photos, storage
-- Run in Supabase SQL Editor AFTER bookable_spaces_and_bookings.sql (or merge into fresh env).
-- Backs up semantics: space_status → vacant/occupied/merged; space_type → office/conference_room/venue/hot_desk
-- =====================================================================

-- ---- room_combinations (merge groups; parent space row lives in bookable_spaces) ----
create table if not exists public.room_combinations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists room_combinations_property_id_idx
  on public.room_combinations (property_id);

create table if not exists public.room_combination_members (
  combination_id uuid not null references public.room_combinations(id) on delete cascade,
  space_id uuid not null references public.bookable_spaces(id) on delete cascade,
  primary key (combination_id, space_id)
);

create index if not exists room_combination_members_space_idx
  on public.room_combination_members (space_id);

-- ---- room_photos ----
create table if not exists public.room_photos (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.bookable_spaces(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists room_photos_space_id_idx on public.room_photos (space_id);

-- ---- Alter bookable_spaces: new columns (idempotent for re-run) ----
alter table public.bookable_spaces add column if not exists size_m2 numeric(12, 2);
alter table public.bookable_spaces add column if not exists amenity_projector boolean not null default false;
alter table public.bookable_spaces add column if not exists amenity_whiteboard boolean not null default false;
alter table public.bookable_spaces add column if not exists amenity_video_conferencing boolean not null default false;
alter table public.bookable_spaces add column if not exists amenity_kitchen_access boolean not null default false;
alter table public.bookable_spaces add column if not exists amenity_parking boolean not null default false;
alter table public.bookable_spaces add column if not exists amenity_natural_light boolean not null default false;
alter table public.bookable_spaces add column if not exists amenity_air_conditioning boolean not null default false;
alter table public.bookable_spaces add column if not exists amenity_standing_desk boolean not null default false;
alter table public.bookable_spaces add column if not exists amenity_phone_booth boolean not null default false;
alter table public.bookable_spaces add column if not exists amenity_reception_service boolean not null default false;

alter table public.bookable_spaces add column if not exists monthly_rent_eur numeric(12, 2);
alter table public.bookable_spaces add column if not exists tenant_company_name text;
alter table public.bookable_spaces add column if not exists tenant_contact_name text;
alter table public.bookable_spaces add column if not exists tenant_contact_email text;
alter table public.bookable_spaces add column if not exists tenant_contact_phone text;
alter table public.bookable_spaces add column if not exists contract_start date;
alter table public.bookable_spaces add column if not exists contract_end date;
alter table public.bookable_spaces add column if not exists security_deposit_eur numeric(12, 2);
alter table public.bookable_spaces add column if not exists hide_tenant_in_ui boolean not null default false;

alter table public.bookable_spaces add column if not exists half_day_price_eur numeric(12, 2);
alter table public.bookable_spaces add column if not exists full_day_price_eur numeric(12, 2);
alter table public.bookable_spaces add column if not exists min_booking_hours numeric(8, 2);
alter table public.bookable_spaces add column if not exists daily_price_eur numeric(12, 2);

alter table public.bookable_spaces add column if not exists combination_id uuid references public.room_combinations(id) on delete set null;
alter table public.bookable_spaces add column if not exists is_combination_parent boolean not null default false;

-- ---- Migrate enums / status values ----
alter table public.bookable_spaces drop constraint if exists bookable_spaces_space_type_check;
update public.bookable_spaces set space_type = 'conference_room' where space_type = 'meeting_room';
update public.bookable_spaces set space_type = 'hot_desk' where space_type = 'desk';
alter table public.bookable_spaces
  add constraint bookable_spaces_space_type_check check (
    space_type in ('office', 'conference_room', 'venue', 'hot_desk')
  );

alter table public.bookable_spaces drop constraint if exists bookable_spaces_status_check;
update public.bookable_spaces set space_status = 'vacant' where space_status = 'available';
update public.bookable_spaces set space_status = 'occupied' where space_status = 'unavailable';
alter table public.bookable_spaces
  add constraint bookable_spaces_status_check check (
    space_status in ('vacant', 'occupied', 'under_maintenance', 'merged')
  );

alter table public.bookable_spaces alter column space_status set default 'vacant';

-- One combination parent per group (when used)
create unique index if not exists bookable_spaces_one_combo_parent_idx
  on public.bookable_spaces (combination_id)
  where is_combination_parent = true and combination_id is not null;

-- ---- Booking trigger: vacant only; offices not hourly-bookable via this flow ----
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
begin
  select bs.property_id, p.tenant_id, bs.requires_approval, bs.hourly_price, bs.space_status, bs.space_type
  into v_property_id, v_tenant_id, v_requires, v_hourly, v_space_status, v_space_type
  from public.bookable_spaces bs
  join public.properties p on p.id = bs.property_id
  where bs.id = new.space_id;

  if v_property_id is null then
    raise exception 'Invalid space_id';
  end if;

  if v_space_status is distinct from 'vacant' then
    raise exception 'Space is not available for booking';
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

-- ---- Anon policy: public bookable spaces ----
drop policy if exists "bookable_spaces_select_anon" on public.bookable_spaces;
create policy "bookable_spaces_select_anon"
on public.bookable_spaces
for select
to anon
using (space_status = 'vacant');

-- ---- RLS: room_combinations ----
alter table public.room_combinations enable row level security;

drop policy if exists "room_combinations_select" on public.room_combinations;
create policy "room_combinations_select"
on public.room_combinations
for select
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.properties p
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = auth.uid()
    where p.id = room_combinations.property_id
      and lower(m.role) in (
        'owner', 'manager', 'viewer', 'customer_service',
        'accounting', 'maintenance', 'tenant'
      )
  )
);

drop policy if exists "room_combinations_write" on public.room_combinations;
create policy "room_combinations_write"
on public.room_combinations
for all
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.properties p
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = auth.uid()
    where p.id = room_combinations.property_id
      and lower(m.role) in ('owner', 'manager')
  )
)
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1 from public.properties p
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = auth.uid()
    where p.id = room_combinations.property_id
      and lower(m.role) in ('owner', 'manager')
  )
);

-- ---- RLS: room_combination_members ----
alter table public.room_combination_members enable row level security;

drop policy if exists "room_combination_members_select" on public.room_combination_members;
create policy "room_combination_members_select"
on public.room_combination_members
for select
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1
    from public.room_combinations rc
    join public.properties p on p.id = rc.property_id
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = auth.uid()
    where rc.id = room_combination_members.combination_id
      and lower(m.role) in (
        'owner', 'manager', 'viewer', 'customer_service',
        'accounting', 'maintenance', 'tenant'
      )
  )
);

drop policy if exists "room_combination_members_write" on public.room_combination_members;
create policy "room_combination_members_write"
on public.room_combination_members
for all
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1
    from public.room_combinations rc
    join public.properties p on p.id = rc.property_id
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = auth.uid()
    where rc.id = room_combination_members.combination_id
      and lower(m.role) in ('owner', 'manager')
  )
)
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1
    from public.room_combinations rc
    join public.properties p on p.id = rc.property_id
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = auth.uid()
    where rc.id = room_combination_members.combination_id
      and lower(m.role) in ('owner', 'manager')
  )
);

-- ---- RLS: room_photos ----
alter table public.room_photos enable row level security;

drop policy if exists "room_photos_select" on public.room_photos;
create policy "room_photos_select"
on public.room_photos
for select
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1
    from public.bookable_spaces bs
    join public.properties p on p.id = bs.property_id
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = auth.uid()
    where bs.id = room_photos.space_id
      and lower(m.role) in (
        'owner', 'manager', 'viewer', 'customer_service',
        'accounting', 'maintenance', 'tenant'
      )
  )
);

-- Public read for vacant room photos (optional): omit anon policy — visitor booking does not list photos in MVP

drop policy if exists "room_photos_insert" on public.room_photos;
create policy "room_photos_insert"
on public.room_photos
for insert
to authenticated
with check (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1
    from public.bookable_spaces bs
    join public.properties p on p.id = bs.property_id
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = auth.uid()
    where bs.id = room_photos.space_id
      and lower(m.role) in ('owner', 'manager')
  )
);

drop policy if exists "room_photos_delete" on public.room_photos;
create policy "room_photos_delete"
on public.room_photos
for delete
to authenticated
using (
  exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
  or exists (
    select 1
    from public.bookable_spaces bs
    join public.properties p on p.id = bs.property_id
    join public.memberships m on m.tenant_id = p.tenant_id and m.user_id = auth.uid()
    where bs.id = room_photos.space_id
      and lower(m.role) in ('owner', 'manager')
  )
);

drop trigger if exists trg_room_combinations_touch on public.room_combinations;
create trigger trg_room_combinations_touch
before update on public.room_combinations
for each row execute function public.touch_updated_at();

-- ---- Storage bucket for room photos ----
insert into storage.buckets (id, name, public)
values ('room-photos', 'room-photos', true)
on conflict (id) do nothing;

drop policy if exists "room photos public read" on storage.objects;
create policy "room photos public read"
on storage.objects
for select
to public
using (bucket_id = 'room-photos');

drop policy if exists "room photos authenticated upload" on storage.objects;
create policy "room photos authenticated upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'room-photos'
  and (
    exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
    or exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid() and lower(m.role) in ('owner', 'manager')
    )
  )
);

drop policy if exists "room photos authenticated delete" on storage.objects;
create policy "room photos authenticated delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'room-photos'
  and (
    exists (select 1 from public.memberships m where m.user_id = auth.uid() and lower(m.role) = 'super_admin')
    or exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid() and lower(m.role) in ('owner', 'manager')
    )
  )
);

comment on table public.room_combinations is 'Merged room groups; parent bookable_space has is_combination_parent true.';
comment on table public.room_photos is 'Image paths in storage bucket room-photos.';
comment on column public.bookable_spaces.hide_tenant_in_ui is 'When true, UI hides tenant lease fields from managers (owners always see).';
