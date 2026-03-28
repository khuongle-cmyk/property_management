-- Calculation mode for administration fees (separate from fee category in fee_type / custom_name).

alter table public.administration_cost_settings
  add column if not exists calculation_mode text;

alter table public.administration_cost_settings
  drop constraint if exists administration_cost_settings_calculation_mode_check;

alter table public.administration_cost_settings
  add constraint administration_cost_settings_calculation_mode_check
  check (
    calculation_mode is null
    or calculation_mode in ('fixed', 'percentage', 'combination')
  );

-- Default for new rows (application sends explicitly).
alter table public.administration_cost_settings
  alter column calculation_mode set default 'fixed';

-- Best-effort backfill from old values stored in fee_type before category split.
update public.administration_cost_settings
set calculation_mode = case
  when fee_type = 'fixed_amount' then 'fixed'
  when fee_type in ('percentage_of_revenue', 'percentage_of_costs') then 'percentage'
  when fee_type = 'fixed_plus_percentage' then 'combination'
  else calculation_mode
end
where calculation_mode is null
  and fee_type in ('fixed_amount', 'percentage_of_revenue', 'percentage_of_costs', 'fixed_plus_percentage');

comment on column public.administration_cost_settings.calculation_mode is
  'fixed | percentage | combination — how fixed_amount and percentage_value combine';
