-- Phase 1 voice assistant telemetry
-- Stores command text, detected intent, and action outcome.

create table if not exists public.voice_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  language text not null,
  transcribed_text text not null,
  intent text not null,
  parameters jsonb not null default '{}'::jsonb,
  action_taken boolean not null default false,
  success boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists voice_commands_user_idx on public.voice_commands (user_id, created_at desc);
create index if not exists voice_commands_tenant_idx on public.voice_commands (tenant_id, created_at desc);
create index if not exists voice_commands_intent_idx on public.voice_commands (intent, created_at desc);

alter table public.voice_commands enable row level security;

drop policy if exists voice_commands_select_own on public.voice_commands;
create policy voice_commands_select_own
on public.voice_commands
for select
using (auth.uid() = user_id);

drop policy if exists voice_commands_insert_own on public.voice_commands;
create policy voice_commands_insert_own
on public.voice_commands
for insert
with check (auth.uid() = user_id);
