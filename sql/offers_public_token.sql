-- Public share + acceptance for contract-tool offers
alter table public.offers
  add column if not exists public_token text,
  add column if not exists accepted_at timestamptz;

create unique index if not exists offers_public_token_uq
  on public.offers (public_token)
  where public_token is not null;
