create extension if not exists pgcrypto;

create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  space_type text not null check (space_type in ('office','hot_desk','meeting_room','venue','virtual_office')),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists task_templates_tenant_space_idx on public.task_templates(tenant_id, space_type);

create table if not exists public.task_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.task_templates(id) on delete cascade,
  title text not null,
  description text,
  category text not null check (category in ('access','it','furniture','admin','welcome','invoicing','portal','orientation')),
  default_assignee_role text not null check (default_assignee_role in ('manager','maintenance','accounting','customer_service')),
  due_days_after_start integer not null default 0,
  order_index integer not null default 0,
  is_required boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists task_template_items_template_idx on public.task_template_items(template_id, order_index);

create table if not exists public.client_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid references public.room_contracts(id) on delete set null,
  contact_id uuid references public.leads(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  room_id uuid references public.bookable_spaces(id) on delete set null,
  template_id uuid references public.task_templates(id) on delete set null,
  title text not null,
  description text,
  category text not null check (category in ('access','it','furniture','admin','welcome','invoicing','portal','orientation')),
  status text not null default 'todo' check (status in ('todo','in_progress','done','skipped')),
  assigned_to_user_id uuid references auth.users(id) on delete set null,
  due_date date,
  completed_at timestamptz,
  completed_by_user_id uuid references auth.users(id) on delete set null,
  notes text,
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_tasks_tenant_status_due_idx on public.client_tasks(tenant_id, status, due_date);
create index if not exists client_tasks_assignee_idx on public.client_tasks(assigned_to_user_id, due_date);
create index if not exists client_tasks_client_idx on public.client_tasks(contact_id, order_index);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.client_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  comment text not null,
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments(task_id, created_at desc);

alter table public.task_templates enable row level security;
alter table public.task_template_items enable row level security;
alter table public.client_tasks enable row level security;
alter table public.task_comments enable row level security;

drop policy if exists task_templates_select on public.task_templates;
create policy task_templates_select on public.task_templates
for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = task_templates.tenant_id
      and lower(coalesce(m.role,'')) in ('owner','manager','customer_service','accounting','maintenance','viewer','super_admin')
  )
);
drop policy if exists task_templates_write on public.task_templates;
create policy task_templates_write on public.task_templates
for all using (public.can_manage_tenant_data(task_templates.tenant_id))
with check (public.can_manage_tenant_data(task_templates.tenant_id));

drop policy if exists task_template_items_select on public.task_template_items;
create policy task_template_items_select on public.task_template_items
for select using (
  exists (
    select 1
    from public.task_templates t
    join public.memberships m on m.tenant_id = t.tenant_id and m.user_id = auth.uid()
    where t.id = task_template_items.template_id
      and lower(coalesce(m.role,'')) in ('owner','manager','customer_service','accounting','maintenance','viewer','super_admin')
  )
);
drop policy if exists task_template_items_write on public.task_template_items;
create policy task_template_items_write on public.task_template_items
for all using (
  exists (
    select 1 from public.task_templates t
    where t.id = task_template_items.template_id
      and public.can_manage_tenant_data(t.tenant_id)
  )
)
with check (
  exists (
    select 1 from public.task_templates t
    where t.id = task_template_items.template_id
      and public.can_manage_tenant_data(t.tenant_id)
  )
);

drop policy if exists client_tasks_select on public.client_tasks;
create policy client_tasks_select on public.client_tasks
for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = client_tasks.tenant_id
      and lower(coalesce(m.role,'')) in ('owner','manager','customer_service','accounting','maintenance','viewer','super_admin')
  )
);
drop policy if exists client_tasks_write on public.client_tasks;
create policy client_tasks_write on public.client_tasks
for all using (
  public.can_manage_tenant_data(client_tasks.tenant_id)
  or client_tasks.assigned_to_user_id = auth.uid()
)
with check (public.can_manage_tenant_data(client_tasks.tenant_id));

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments
for select using (
  exists (
    select 1
    from public.client_tasks t
    join public.memberships m on m.tenant_id = t.tenant_id and m.user_id = auth.uid()
    where t.id = task_comments.task_id
      and lower(coalesce(m.role,'')) in ('owner','manager','customer_service','accounting','maintenance','viewer','super_admin')
  )
);
drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments
for insert with check (
  exists (
    select 1
    from public.client_tasks t
    join public.memberships m on m.tenant_id = t.tenant_id and m.user_id = auth.uid()
    where t.id = task_comments.task_id
      and lower(coalesce(m.role,'')) in ('owner','manager','customer_service','accounting','maintenance','super_admin')
  )
);
