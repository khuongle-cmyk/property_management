-- =====================================================================
-- Customer portal: link bookings to customer_users; company-scoped invoices
-- Run after customer_companies_schema.sql + bookable_spaces_and_bookings.sql
-- =====================================================================

alter table public.bookings
  add column if not exists customer_user_id uuid references public.customer_users(id) on delete set null;

alter table public.bookings
  add column if not exists customer_company_id uuid references public.customer_companies(id) on delete set null;

create index if not exists bookings_customer_user_idx on public.bookings(customer_user_id) where customer_user_id is not null;
create index if not exists bookings_customer_company_idx on public.bookings(customer_company_id) where customer_company_id is not null;

-- Optional: keep company_id in sync when customer_user_id is set (denormalized for RLS)
create or replace function public.bookings_set_customer_company()
returns trigger
language plpgsql
as $$
begin
  if new.customer_user_id is not null and (new.customer_company_id is null or tg_op = 'INSERT') then
    select cu.company_id into new.customer_company_id
    from public.customer_users cu
    where cu.id = new.customer_user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bookings_customer_company on public.bookings;
create trigger trg_bookings_customer_company
before insert or update of customer_user_id
on public.bookings
for each row
execute function public.bookings_set_customer_company();

-- ---- Customer-facing invoices (separate from legacy renter invoices) ----
create table if not exists public.customer_invoices (
  id uuid primary key default gen_random_uuid(),
  customer_company_id uuid not null references public.customer_companies(id) on delete cascade,
  invoice_number text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue', 'cancelled')),
  amount numeric(14, 2) not null,
  currency text not null default 'EUR',
  issue_date date not null default (CURRENT_DATE),
  due_date date not null,
  paid_at timestamptz,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_invoices_number_company_uidx
  on public.customer_invoices(customer_company_id, invoice_number);

create index if not exists customer_invoices_company_idx on public.customer_invoices(customer_company_id);
create index if not exists customer_invoices_status_idx on public.customer_invoices(status);

alter table public.customer_invoices enable row level security;

drop policy if exists "customer_invoices_select_portal" on public.customer_invoices;
create policy "customer_invoices_select_portal"
on public.customer_invoices for select to authenticated
using (
  exists (
    select 1 from public.customer_users cu
    where cu.auth_user_id = auth.uid()
      and cu.company_id = customer_invoices.customer_company_id
  )
);

-- ---- Bookings: portal users can read/update their rows ----
drop policy if exists "bookings_select_customer" on public.bookings;
create policy "bookings_select_customer"
on public.bookings for select to authenticated
using (
  exists (
    select 1 from public.customer_users cu
    where cu.auth_user_id = auth.uid()
      and cu.id = bookings.customer_user_id
  )
  or exists (
    select 1 from public.customer_users cu
    where cu.auth_user_id = auth.uid()
      and lower(cu.role) = 'company_admin'
      and cu.company_id = bookings.customer_company_id
      and bookings.customer_company_id is not null
  )
);

drop policy if exists "bookings_update_customer_cancel" on public.bookings;
create policy "bookings_update_customer_cancel"
on public.bookings for update to authenticated
using (
  exists (
    select 1 from public.customer_users cu
    where cu.auth_user_id = auth.uid()
      and cu.id = bookings.customer_user_id
  )
  or exists (
    select 1 from public.customer_users cu
    where cu.auth_user_id = auth.uid()
      and lower(cu.role) = 'company_admin'
      and cu.company_id = bookings.customer_company_id
      and bookings.customer_company_id is not null
  )
)
with check (
  exists (
    select 1 from public.customer_users cu
    where cu.auth_user_id = auth.uid()
      and cu.id = bookings.customer_user_id
  )
  or exists (
    select 1 from public.customer_users cu
    where cu.auth_user_id = auth.uid()
      and lower(cu.role) = 'company_admin'
      and cu.company_id = bookings.customer_company_id
      and bookings.customer_company_id is not null
  )
);

comment on column public.bookings.customer_user_id is 'Set when booking is made by a customer portal user.';
comment on column public.bookings.customer_company_id is 'Denormalized from customer_users.company_id for company_admin queries.';
comment on table public.customer_invoices is 'Invoices shown in the customer portal for a customer company.';
