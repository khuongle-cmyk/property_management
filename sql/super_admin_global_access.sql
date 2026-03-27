-- Super admin global access hardening
-- - Adds reusable helper to detect super admin role.
-- - Updates tenant access helper to bypass tenant_id matching for super admins.
-- - Adds permissive RLS policy on every RLS-enabled public table for super admins.

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and lower(coalesce(m.role, '')) = 'super_admin'
  );
$$;

create or replace function public.can_manage_tenant_data(tid uuid)
returns boolean
language sql
stable
as $$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = tid
        and lower(coalesce(m.role,'')) in ('owner','manager')
    );
$$;

do $$
declare
  tbl record;
begin
  for tbl in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = true
  loop
    execute format(
      'drop policy if exists super_admin_full_access on %I.%I;',
      tbl.schema_name,
      tbl.table_name
    );

    execute format(
      'create policy super_admin_full_access on %I.%I for all using (public.is_super_admin()) with check (public.is_super_admin());',
      tbl.schema_name,
      tbl.table_name
    );
  end loop;
end $$;

