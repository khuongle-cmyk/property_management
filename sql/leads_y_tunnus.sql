-- Public lead chatbot + CRM: optional Finnish business ID (Y-tunnus)
alter table public.leads add column if not exists y_tunnus text;
comment on column public.leads.y_tunnus is 'Finnish business ID (Y-tunnus); optional for chatbot and CRM.';

notify pgrst, 'reload schema';
