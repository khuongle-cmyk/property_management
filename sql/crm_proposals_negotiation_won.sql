-- =====================================================================
-- CRM: room proposals linked to leads, negotiation contract versioning,
--       reserved room status, archived lost leads, remove auto-proposal-on-won
-- Run after: crm_leads_pipeline.sql + billing_contracts_and_invoices.sql
-- =====================================================================

create extension if not exists pgcrypto;

-- ---- Leads: archive + leasing client tenant ----
alter table public.leads
  add column if not exists archived boolean not null default false;

alter table public.leads
  add column if not exists won_client_tenant_id uuid references public.tenants(id) on delete set null;

create index if not exists leads_archived_idx on public.leads(archived) where archived = true;

-- ---- Room proposals: CRM link + lease terms ----
alter table public.room_proposals
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

alter table public.room_proposals
  add column if not exists lease_length_months integer;

alter table public.room_proposals
  add column if not exists special_conditions text;

create index if not exists room_proposals_lead_id_idx on public.room_proposals (lead_id);

-- Allow a distinct "negotiating" status while room stays bookable as available (offer phase).
alter table public.room_proposals drop constraint if exists room_proposals_status_check;
alter table public.room_proposals
  add constraint room_proposals_status_check check (
    status in ('draft', 'sent', 'negotiating', 'accepted', 'rejected')
  );

-- ---- Room contracts: link to lead + versioned negotiation text ----
alter table public.room_contracts
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

alter table public.room_contracts
  add column if not exists negotiation_version integer not null default 1;

alter table public.room_contracts
  add column if not exists contract_terms text;

create index if not exists room_contracts_lead_id_idx on public.room_contracts (lead_id);

drop index if exists room_contracts_proposal_version_uidx;
create unique index if not exists room_contracts_proposal_version_uidx
  on public.room_contracts (source_proposal_id, negotiation_version)
  where source_proposal_id is not null;

-- ---- Space status: reserved (Won — hold for lease) ----
alter table public.bookable_spaces drop constraint if exists bookable_spaces_space_status_check;

alter table public.bookable_spaces
  add constraint bookable_spaces_space_status_check check (
    space_status in (
      'available',
      'occupied',
      'under_maintenance',
      'merged',
      'reserved'
    )
  );

-- Multi-room proposals: line items in room_proposal_items (see crm_proposal_multi_room_items.sql).
-- Open-offer rules per space are enforced in application logic if needed.

-- ---- Remove automatic proposal creation on Won (handled in app) ----
create or replace function public.leads_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := coalesce(auth.uid(), new.created_by_user_id, old.created_by_user_id);

  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();

    insert into public.lead_stage_history (
      lead_id, from_stage, to_stage, changed_by_user_id, changed_at, notes, assigned_agent_user_id, next_action, next_action_date, lost_reason
    )
    values (
      new.id, old.stage, new.stage, v_actor, now(),
      new.stage_notes, new.assigned_agent_user_id, new.next_action, new.next_action_date, new.lost_reason
    );

    insert into public.lead_activities (lead_id, activity_type, actor_user_id, summary, details)
    values (
      new.id, 'stage_changed', v_actor,
      format('Stage changed to %s', new.stage),
      coalesce(new.stage_notes, '')
    );
  end if;

  return new;
end;
$$;

comment on column public.leads.archived is 'When true (typically Lost), lead is hidden from default pipeline lists.';
comment on column public.leads.won_client_tenant_id is 'Lessee org (tenants row) created or linked when lead is Won.';
comment on column public.room_proposals.lead_id is 'CRM lead; one proposal may list many rooms via room_proposal_items.';
comment on column public.room_contracts.negotiation_version is 'Incremented when drafting a new contract revision from the same proposal.';
comment on column public.room_contracts.contract_terms is 'Editable draft / final legal terms for negotiation history.';
