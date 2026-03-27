alter table public.historical_revenue
  add column if not exists account_code text,
  add column if not exists account_name text,
  add column if not exists category text;

alter table public.historical_costs
  add column if not exists account_code text,
  add column if not exists account_name text;

alter table public.historical_revenue
  drop constraint if exists historical_revenue_data_source_check;
alter table public.historical_revenue
  add constraint historical_revenue_data_source_check
  check (data_source in ('manual', 'excel', 'accounting_software', 'procountor_tuloslaskelma'));

alter table public.historical_costs
  drop constraint if exists historical_costs_data_source_check;
alter table public.historical_costs
  add constraint historical_costs_data_source_check
  check (data_source in ('manual', 'excel', 'accounting_software', 'procountor_tuloslaskelma'));
