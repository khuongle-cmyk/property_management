# Property Management (Next.js + Supabase)

Multi-tenant SaaS (owners) setup. Owners sign in and can view only properties
for the tenant(s) they are members of.

## Step-by-step (Supabase first time)

1. Create a Supabase project
   - Go to [Supabase](https://supabase.com/) and create an account.
   - Create a new project (any name is fine).
2. Enable email/password login
   - In your project dashboard, open `Authentication` -> `Providers`.
   - Turn on `Email`.
   - (Optional for quick testing) In `Authentication` settings, you can disable email confirmations so you can sign in immediately.
3. Get your Supabase URL + anon key
   - Open `Project Settings` -> `API`.
   - Copy:
     - `Project URL` -> `NEXT_PUBLIC_SUPABASE_URL`
     - `anon public key` -> `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Create the tables + RLS policies (run the SQL)
   - Go to `Database` -> `SQL Editor`.
   - Run the SQL in the next section (`1) Create the Supabase schema...`).
   - Note: this SQL drops existing tables first, so do this on a fresh project or after backups.
5. Create your first tenant (owner company)
   - In `SQL Editor`, insert a tenant:
     ```sql
     insert into public.tenants (name) values ('Acme Property Owners') returning id;
     ```
   - Copy the returned `id` into `<TENANT_ID>` below.
6. Create properties for that tenant
   - Insert properties using the copied `<TENANT_ID>`:
     ```sql
     insert into public.properties (tenant_id, name, address, postal_code, city, total_units, occupied_units, status)
     values ('<TENANT_ID>', 'Greenwood Apartments', '123 Main St', '11111', 'Springfield', 20, 12, 'active');
     ```
7. Create an owner user (login account)
   - Go to `Authentication` -> `Users` and create a user with an email/password (for example `owner@acme.com`).
   - Copy that user's `id` (this is the `<USER_ID>`).
8. Connect the user to the tenant (membership)
   - Insert the membership:
     ```sql
     insert into public.memberships (tenant_id, user_id, role)
     values ('<TENANT_ID>', '<USER_ID>', 'owner');
     ```
9. Create your `super_admin` account and link it
   - Create another auth user in `Authentication` -> `Users` (for example `admin@yourcompany.com`)
   - Copy its `id` as `<SUPER_ADMIN_USER_ID>`
   - Link it to *any* tenant (choose the one you created) with role `super_admin`:
     ```sql
     insert into public.memberships (tenant_id, user_id, role)
     values ('<TENANT_ID>', '<SUPER_ADMIN_USER_ID>', 'super_admin');
     ```
10. Run the Next.js app and sign in
   - In `property-management-system/`, copy `.env.local.example` to `.env.local`.
   - Fill in your `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - Start the app:
     ```bash
     npm install
     npm run dev
     ```
   - Open `/login`, sign in as the owner you created, and open `/dashboard`.

## 1) Create the Supabase schema (tables + RLS)

Run the following SQL in the Supabase dashboard (SQL editor):

```sql
-- WARNING: This is destructive for these tables.
-- If you already have production data, do NOT run this as-is.

drop table if exists public.properties cascade;
drop table if exists public.maintenance_tickets cascade;
drop table if exists public.room_bookings cascade;
drop table if exists public.invoices cascade;
drop table if exists public.memberships cascade;
drop table if exists public.users cascade;
drop table if exists public.tenants cascade;

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_email text,
  contact_phone text,
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  phone text,
  display_name text,
  created_at timestamptz not null default now()
);

-- Connects users to the tenant(s) they own/subscribed to.
create table public.memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  constraint memberships_role_check check (
    role in (
      'super_admin',
      'owner',
      'manager',
      'customer_service',
      'accounting',
      'maintenance',
      'tenant',
      'viewer'
    )
  ),
  primary key (tenant_id, user_id)
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  address text not null,
  postal_code text,
  city text not null,
  total_units integer not null default 0,
  occupied_units integer not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint properties_status_check check (status in ('active','inactive','under_renovation')),
  constraint properties_units_non_negative check (total_units >= 0 and occupied_units >= 0),
  constraint properties_occupied_not_greater_than_total check (occupied_units <= total_units)
);

-- Repair tickets (maintenance)
create table public.maintenance_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open',
  assigned_to_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Room/unit bookings (renter-facing)
create table public.room_bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_number text not null,
  renter_user_id uuid not null references public.users(id) on delete cascade,
  start_date date not null,
  end_date date,
  -- Customer-service-facing flags (yes/no). No financial amounts here.
  reservation_deposit_paid boolean not null default false,
  reservation_payment_made boolean not null default false,
  created_at timestamptz not null default now()
);

-- Financials (accounting-facing)
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  renter_user_id uuid not null references public.users(id) on delete cascade,
  invoice_number text not null unique,
  invoice_date date not null,
  due_date date not null,
  amount numeric not null,
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

-- Auto-create profile row in public.users when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, phone)
  values (new.id, new.email, new.phone)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Enable RLS
alter table public.tenants enable row level security;
alter table public.users enable row level security;
alter table public.memberships enable row level security;
alter table public.properties enable row level security;
alter table public.maintenance_tickets enable row level security;
alter table public.room_bookings enable row level security;
alter table public.invoices enable row level security;

-- Allow super_admin to create tenants and memberships (so the UI can add owners)
drop policy if exists "Tenant insert - super_admin" on public.tenants;
create policy "Tenant insert - super_admin"
on public.tenants
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and lower(m.role) = 'super_admin'
  )
);

drop policy if exists "Membership insert - super_admin" on public.memberships;
create policy "Membership insert - super_admin"
on public.memberships
for insert
to authenticated
with check (
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and lower(m.role) = 'super_admin'
  )
);

-- Tenants: owners see only tenants they are members of
drop policy if exists "Tenant read - owner" on public.tenants;
create policy "Tenant read - owner"
on public.tenants
for select
to authenticated
using (
  -- Global super_admin can read everything
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and lower(m.role) = 'super_admin'
  )
  or (
    -- Tenant-scoped access for owner/manager/viewer/customer_service
    exists (
      select 1
      from public.memberships m
      where m.tenant_id = tenants.id
        and m.user_id = auth.uid()
        and lower(m.role) in ('owner', 'manager', 'viewer', 'customer_service')
    )
  )
);

-- Users: each user sees only their own profile row.
-- Super admins can also see all user rows (for admin workflows later).
drop policy if exists "User read - self" on public.users;
create policy "User read - self"
on public.users
for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.memberships m2
    where m2.user_id = auth.uid()
      and lower(m2.role) = 'super_admin'
  )
);

-- Memberships: users can always see their own membership rows.
-- Super admins can see everything.
drop policy if exists "Membership read - owner" on public.memberships;
create policy "Membership read - owner"
on public.memberships
for select
to authenticated
using (user_id = auth.uid());

-- Allow super_admin to see all memberships
drop policy if exists "Membership read - super_admin" on public.memberships;
create policy "Membership read - super_admin"
on public.memberships
for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m2
    where m2.user_id = auth.uid()
      and lower(m2.role) = 'super_admin'
  )
);

-- Properties: each owner sees only properties for tenants they belong to
drop policy if exists "Property read - owner" on public.properties;
create policy "Property read - owner"
on public.properties
for select
to authenticated
using (
  -- Global super_admin can read everything
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and lower(m.role) = 'super_admin'
  )
  or (
    -- Tenant-scoped access for owner/manager/viewer
    exists (
      select 1
      from public.memberships m
      where m.tenant_id = properties.tenant_id
        and m.user_id = auth.uid()
        and lower(m.role) in ('owner', 'manager', 'viewer')
    )
  )
);

-- maintenance_tickets: super_admin can read everything; maintenance sees assigned tickets; customer_service sees
-- tickets for tenants they belong to. No accounting access here.
drop policy if exists "Tickets read - maintenance/customer_service" on public.maintenance_tickets;
create policy "Tickets read - maintenance/customer_service"
on public.maintenance_tickets
for select
to authenticated
using (
  -- Global super_admin can read everything
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and lower(m.role) = 'super_admin'
  )
  or (
    -- Maintenance can read only tickets assigned to them
    assigned_to_user_id = auth.uid()
    and exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = maintenance_tickets.tenant_id
        and lower(m.role) = 'maintenance'
    )
  )
  or (
    -- Customer service can read all tickets for tenants they support
    exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = maintenance_tickets.tenant_id
        and lower(m.role) = 'customer_service'
    )
  )
);

-- room_bookings: super_admin + viewer/customer_service see tenant bookings; tenant sees their own.
-- No accounting access here (accounting is invoices/reports only).
drop policy if exists "Room bookings read - tenant/customer_service" on public.room_bookings;
create policy "Room bookings read - tenant/customer_service"
on public.room_bookings
for select
to authenticated
using (
  -- Global super_admin can read everything
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and lower(m.role) = 'super_admin'
  )
  or (
    -- Tenant (renter) can read only their own bookings
    renter_user_id = auth.uid()
    and exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = room_bookings.tenant_id
        and lower(m.role) = 'tenant'
    )
  )
  or (
    -- Customer service can read bookings for tenants they support
    exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = room_bookings.tenant_id
        and lower(m.role) = 'customer_service'
    )
  )
  or (
    -- Viewer (auditors) can read bookings for tenants they have viewer access to
    exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = room_bookings.tenant_id
        and lower(m.role) = 'viewer'
    )
  )
);

-- invoices: only super_admin + accounting + tenant + viewer (no customer_service financial access)
drop policy if exists "Invoices read - accounting/tenant/viewer" on public.invoices;
create policy "Invoices read - accounting/tenant/viewer"
on public.invoices
for select
to authenticated
using (
  -- Global super_admin can read everything
  exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and lower(m.role) = 'super_admin'
  )
  or (
    -- Accounting can read invoices for their tenant
    exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = invoices.tenant_id
        and lower(m.role) = 'accounting'
    )
  )
  or (
    -- Tenant (renter) can read only their own invoices
    renter_user_id = auth.uid()
    and exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = invoices.tenant_id
        and lower(m.role) = 'tenant'
    )
  )
  or (
    -- Viewer (auditors) can read invoices for tenants they have viewer access to
    exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = invoices.tenant_id
        and lower(m.role) = 'viewer'
    )
  )
);
```

## 2) Add sample data + connect an owner user

```sql
-- 1) Create an owner tenant
insert into public.tenants (name)
values ('Acme Property Owners')
returning id;

-- Copy the returned tenant_id into the next statements:
--   <TENANT_ID>

-- 2) Create properties for that tenant
insert into public.properties (tenant_id, name, address, postal_code, city, total_units, occupied_units, status)
values
  ('<TENANT_ID>', 'Greenwood Apartments', '123 Main St', '11111', 'Springfield', 20, 12, 'active'),
  ('<TENANT_ID>', 'Sunset Lofts', '456 Sunset Ave', '22222', 'Shelbyville', 10, 3, 'under_renovation');

-- 3) Create/choose an owner user (via Supabase Auth UI)
-- then connect them to the tenant:
--
-- Find the user's uuid:
select id
from auth.users
where email = 'owner@acme.com';

-- Copy the returned user_id and then:
-- insert membership:
insert into public.memberships (tenant_id, user_id, role)
values ('<TENANT_ID>', '<USER_ID>', 'owner');
```

## 3) Configure environment variables

Copy `.env.local.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 4) Run the app

```bash
cd property-management-system
npm install
npm run dev
```

Then open the URL shown by `next dev`.

## Notes / Next steps

- The Next.js app uses Supabase Auth to identify the logged-in owner, then RLS restricts reads to tenant-scoped data.
- This is read-only from the app for now (dashboard only).
- The SQL includes a trigger to auto-create `public.users` rows on signup. If that insert is blocked in your environment, ensure the `public.handle_new_user()` function is owned by a role with insert privileges on `public.users` (the Supabase default templates typically use `postgres`).

