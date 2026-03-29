-- =====================================================================
-- Fix booking insert trigger: accept space_status available OR vacant,
-- require is_published (when column exists), keep office / overlap rules.
-- Run in Supabase SQL Editor if inserts fail with "Space is not available for booking"
-- while the space is bookable in the UI.
-- =====================================================================

alter table public.bookable_spaces
  add column if not exists is_published boolean not null default true;

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

-- Keep anon policy aligned with both statuses (if policy exists)
drop policy if exists "bookable_spaces_select_anon" on public.bookable_spaces;
create policy "bookable_spaces_select_anon"
on public.bookable_spaces
for select
to anon
using (
  space_status in ('available', 'vacant')
  and coalesce(is_published, true) = true
);
