-- Manual archive for completed (done/skipped) tasks. Run in Supabase SQL editor or migration pipeline.

alter table public.client_tasks add column if not exists archived boolean not null default false;

create index if not exists client_tasks_tenant_archived_idx on public.client_tasks(tenant_id, archived);

comment on column public.client_tasks.archived is 'When true, task is hidden from the active board/list until restored. Only done/skipped tasks may be archived via API validation.';
