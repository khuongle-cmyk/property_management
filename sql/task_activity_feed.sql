create table if not exists public.task_activities (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.client_tasks(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  activity_type text not null check (activity_type in ('created','status_changed','reassigned','due_date_changed','comment_added','completed','updated')),
  from_value text,
  to_value text,
  message text,
  created_at timestamptz not null default now()
);
create index if not exists task_activities_task_created_idx on public.task_activities(task_id, created_at);

alter table public.task_activities enable row level security;

drop policy if exists task_activities_select on public.task_activities;
create policy task_activities_select on public.task_activities
for select using (
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = task_activities.tenant_id
      and lower(coalesce(m.role,'')) in ('owner','manager','customer_service','accounting','maintenance','viewer','super_admin')
  )
);

drop policy if exists task_activities_insert on public.task_activities;
create policy task_activities_insert on public.task_activities
for insert with check (
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = task_activities.tenant_id
      and lower(coalesce(m.role,'')) in ('owner','manager','customer_service','accounting','maintenance','super_admin')
  )
);
