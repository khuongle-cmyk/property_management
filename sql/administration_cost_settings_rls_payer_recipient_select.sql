-- Extend tenant SELECT on administration_cost_settings so org members can read fees
-- that charge them when stored as platform-billed rows:
--   tenant_id = billing org, recipient_tenant_id = payer (property org).
-- Run after sql/administration_cost_settings_rls.sql

drop policy if exists administration_cost_settings_tenant_select on public.administration_cost_settings;

create policy administration_cost_settings_tenant_select on public.administration_cost_settings
  for select
  using (
    exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and (
          m.tenant_id = administration_cost_settings.tenant_id
          or m.tenant_id = administration_cost_settings.recipient_tenant_id
        )
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
