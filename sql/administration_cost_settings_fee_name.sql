-- Optional: add fee_name mirroring display label (maps to the same value as `name`).
-- Run if you want a dedicated fee_name column for reporting / exports.

alter table public.administration_cost_settings add column if not exists fee_name text;

update public.administration_cost_settings
set fee_name = coalesce(fee_name, name)
where fee_name is null;

comment on column public.administration_cost_settings.fee_name is 'Display label for the fee (optional duplicate of name).';
