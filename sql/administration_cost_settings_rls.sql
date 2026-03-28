-- Optional RLS for administration_cost_settings (run after table exists).
-- Requires public.is_super_admin() — see sql/super_admin_global_access.sql

alter table public.administration_cost_settings enable row level security;

drop policy if exists administration_cost_settings_super_admin_all on public.administration_cost_settings;
create policy administration_cost_settings_super_admin_all on public.administration_cost_settings
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists administration_cost_settings_tenant_select on public.administration_cost_settings;
create policy administration_cost_settings_tenant_select on public.administration_cost_settings
  for select
  using (
    exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = administration_cost_settings.tenant_id
        and lower(coalesce(m.role, '')) in (
          'owner',
          'manager',
          'customer_service',
          'accounting',
          'viewer',
          'super_admin'
        )
    )
  );
