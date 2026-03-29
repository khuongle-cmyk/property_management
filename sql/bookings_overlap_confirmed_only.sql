-- Run in Supabase if inserts fail due to pending bookings blocking the same slot.
-- Pending no longer blocks; only confirmed overlaps are rejected.

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
      and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(new.start_at, new.end_at, '[)')
  ) then
    raise exception 'This space is already booked for that time range';
  end if;
  return new;
end;
$$;
