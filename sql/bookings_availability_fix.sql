-- =====================================================================
-- Fix false "Space is not available for booking" on inserts + tenant visitor RLS
-- Run in Supabase SQL Editor (or migrate) if calendar/booking inserts fail
-- while the space shows as bookable in the UI.
--
-- Changes:
-- 1) bookings_before_insert: hourly-bookable statuses aligned with app + public API
--    (available, vacant legacy, active).
-- 2) prevent_booking_overlap: explicit overlap predicate (same as
--    start < new_end AND end > new_start) for confirmed rows only.
-- 3) bookings_insert_authenticated: allow tenant role to insert visitor bookings
--    for spaces on their property (calendar UI already offers visitor fields).
-- =====================================================================

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
  v_norm text;
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

  v_norm := lower(trim(coalesce(v_space_status, '')));

  -- CRM / rooms: free-to-book = "available" or legacy "vacant"; "active" kept for public API parity.
  if v_space_status is null or v_norm not in ('available', 'vacant', 'active') then
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

-- Overlap: only confirmed bookings block; cancelled/rejected are not confirmed.
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
      and b.status = 'confirmed'
      and b.start_at < new.end_at
      and b.end_at > new.start_at
  ) then
    raise exception 'This space is already booked for that time range';
  end if;
  return new;
end;
$$;

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
  or (
    bookings.booker_type = 'visitor'
    and bookings.visitor_name is not null
    and bookings.visitor_email is not null
    and bookings.booker_user_id is null
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
