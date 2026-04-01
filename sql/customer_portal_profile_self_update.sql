-- Allow customer portal users to update their own profile fields
drop policy if exists "customer_users_update_portal_self" on public.customer_users;
create policy "customer_users_update_portal_self"
on public.customer_users for update to authenticated
using (customer_users.auth_user_id = auth.uid())
with check (customer_users.auth_user_id = auth.uid());
