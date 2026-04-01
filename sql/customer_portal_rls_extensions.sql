-- =====================================================================
-- Customer portal: RLS for spaces, booking insert, company/team management
-- Run after customer_portal_bookings_invoices.sql + rooms_management_upgrade.sql (room_photos optional)
-- =====================================================================

-- ---- bookable_spaces: portal users at a property-linked company ----------------
drop policy if exists "bookable_spaces_select_customer_portal" on public.bookable_spaces;
create policy "bookable_spaces_select_customer_portal"
on public.bookable_spaces for select to authenticated
using (
  exists (
    select 1
    from public.customer_users cu
    join public.customer_companies cc on cc.id = cu.company_id
    where cu.auth_user_id = auth.uid()
      and cc.property_id is not null
      and cc.property_id = bookable_spaces.property_id
  )
);

-- ---- room_photos: first image on space cards ----------------------------------
drop policy if exists "room_photos_select_customer_portal" on public.room_photos;
create policy "room_photos_select_customer_portal"
on public.room_photos for select to authenticated
using (
  exists (
    select 1
    from public.bookable_spaces bs
    join public.customer_companies cc on cc.property_id = bs.property_id
    join public.customer_users cu on cu.company_id = cc.id
    where bs.id = room_photos.space_id
      and cu.auth_user_id = auth.uid()
  )
);

-- ---- bookings: see other bookings on same property spaces (availability) --------
drop policy if exists "bookings_select_customer_property_calendar" on public.bookings;
create policy "bookings_select_customer_property_calendar"
on public.bookings for select to authenticated
using (
  exists (
    select 1
    from public.bookable_spaces bs
    join public.customer_companies cc on cc.property_id = bs.property_id
    join public.customer_users cu on cu.company_id = cc.id and cu.auth_user_id = auth.uid()
    where bs.id = bookings.space_id
  )
);

-- ---- bookings: portal user creates own booking --------------------------------
drop policy if exists "bookings_insert_customer_portal" on public.bookings;
create policy "bookings_insert_customer_portal"
on public.bookings for insert to authenticated
with check (
  booker_type = 'registered_user'
  and booker_user_id = auth.uid()
  and customer_user_id is not null
  and exists (
    select 1 from public.customer_users cu
    where cu.id = bookings.customer_user_id
      and cu.auth_user_id = auth.uid()
  )
  and exists (
    select 1
    from public.customer_users cu
    join public.customer_companies cc on cc.id = cu.company_id
    join public.bookable_spaces bs on bs.id = bookings.space_id
    where cu.auth_user_id = auth.uid()
      and cc.property_id is not null
      and cc.property_id = bs.property_id
  )
);

-- ---- customer_companies: company_admin can update profile ----------------------
drop policy if exists "customer_companies_update_portal_admin" on public.customer_companies;
create policy "customer_companies_update_portal_admin"
on public.customer_companies for update to authenticated
using (
  exists (
    select 1 from public.customer_users cu
    where cu.company_id = customer_companies.id
      and cu.auth_user_id = auth.uid()
      and lower(cu.role) = 'company_admin'
  )
)
with check (
  exists (
    select 1 from public.customer_users cu
    where cu.company_id = customer_companies.id
      and cu.auth_user_id = auth.uid()
      and lower(cu.role) = 'company_admin'
  )
);

-- ---- customer_users: company_admin lists colleagues -----------------------------
drop policy if exists "customer_users_select_portal_company" on public.customer_users;
create policy "customer_users_select_portal_company"
on public.customer_users for select to authenticated
using (
  exists (
    select 1 from public.customer_users admin
    where admin.auth_user_id = auth.uid()
      and admin.company_id = customer_users.company_id
      and lower(admin.role) = 'company_admin'
  )
);

-- ---- customer_users: company_admin updates role / status ------------------------
drop policy if exists "customer_users_update_portal_company_admin" on public.customer_users;
create policy "customer_users_update_portal_company_admin"
on public.customer_users for update to authenticated
using (
  exists (
    select 1 from public.customer_users admin
    where admin.auth_user_id = auth.uid()
      and admin.company_id = customer_users.company_id
      and lower(admin.role) = 'company_admin'
  )
)
with check (
  exists (
    select 1 from public.customer_users admin
    where admin.auth_user_id = auth.uid()
      and admin.company_id = customer_users.company_id
      and lower(admin.role) = 'company_admin'
  )
);

-- ---- Invoice line items (JSON array) ------------------------------------------
alter table public.customer_invoices
  add column if not exists line_items jsonb not null default '[]'::jsonb;

comment on column public.customer_invoices.line_items is 'Optional line items: [{ "description", "quantity", "unit_price", "amount" }]';
