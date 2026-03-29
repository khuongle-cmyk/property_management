-- =====================================================================
-- Budget tables + RLS (idempotent bootstrap / repair)
-- Run in Supabase SQL Editor if /api/budget or /api/budget/combinations returns 500
-- (missing tables/columns, or RLS policies calling missing SQL helpers).
-- Requires: public.tenants, public.properties, auth.users, public.memberships
-- =====================================================================

-- ---- Drop existing policies on budget tables (avoid broken is_super_admin / can_manage refs)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'budgets',
        'budget_combinations',
        'budget_revenue_lines',
        'budget_cost_lines'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ---- budgets (base table; extended columns match app + budget_planning)
CREATE TABLE IF NOT EXISTS public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties (id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT 'Budget',
  budget_year integer NOT NULL DEFAULT (EXTRACT(year FROM now())::integer),
  budget_type text NOT NULL DEFAULT 'annual',
  status text NOT NULL DEFAULT 'draft',
  budget_scope text NOT NULL DEFAULT 'property',
  notes text,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  opening_cash_balance numeric(16, 2) NOT NULL DEFAULT 0,
  parent_budget_id uuid REFERENCES public.budgets (id) ON DELETE SET NULL,
  version_label text
);

ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS budget_scope text NOT NULL DEFAULT 'property';
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS opening_cash_balance numeric(16, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS parent_budget_id uuid;
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS version_label text;
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS budgets_tenant_year_idx ON public.budgets (tenant_id, budget_year DESC);

-- ---- budget_combinations
CREATE TABLE IF NOT EXISTS public.budget_combinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Portfolio',
  property_ids uuid[] NOT NULL DEFAULT '{}',
  include_admin boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.budget_combinations ADD COLUMN IF NOT EXISTS property_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.budget_combinations ADD COLUMN IF NOT EXISTS include_admin boolean NOT NULL DEFAULT true;
ALTER TABLE public.budget_combinations ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
ALTER TABLE public.budget_combinations ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;
ALTER TABLE public.budget_combinations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS budget_combinations_tenant_idx ON public.budget_combinations (tenant_id);

-- ---- budget_revenue_lines (flexible category text for imports / UI)
CREATE TABLE IF NOT EXISTS public.budget_revenue_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES public.budgets (id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties (id) ON DELETE CASCADE,
  month integer NOT NULL,
  year integer NOT NULL,
  category text NOT NULL DEFAULT 'office_rent',
  budgeted_amount numeric(16, 2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.budget_revenue_lines ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.budget_revenue_lines ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS budget_revenue_lines_budget_idx ON public.budget_revenue_lines (budget_id);

-- ---- budget_cost_lines
CREATE TABLE IF NOT EXISTS public.budget_cost_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES public.budgets (id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties (id) ON DELETE CASCADE,
  month integer NOT NULL,
  year integer NOT NULL,
  cost_type text NOT NULL DEFAULT 'other',
  budgeted_amount numeric(16, 2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.budget_cost_lines ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.budget_cost_lines ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS budget_cost_lines_budget_idx ON public.budget_cost_lines (budget_id);

-- ---- RLS
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_combinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_revenue_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_cost_lines ENABLE ROW LEVEL SECURITY;

-- Readers: finance/report roles + super_admin (any membership row)
CREATE POLICY budgets_select_fix ON public.budgets
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.tenant_id = budgets.tenant_id
      AND lower(trim(coalesce(m.role::text, ''))) IN (
        'owner',
        'manager',
        'customer_service',
        'accounting',
        'viewer'
      )
  )
);

CREATE POLICY budgets_insert_fix ON public.budgets
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.tenant_id = budgets.tenant_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
);

CREATE POLICY budgets_update_fix ON public.budgets
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.tenant_id = budgets.tenant_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.tenant_id = budgets.tenant_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
);

CREATE POLICY budgets_delete_fix ON public.budgets
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.tenant_id = budgets.tenant_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
);

-- budget_combinations
CREATE POLICY budget_combinations_select_fix ON public.budget_combinations
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.tenant_id = budget_combinations.tenant_id
      AND lower(trim(coalesce(m.role::text, ''))) IN (
        'owner',
        'manager',
        'customer_service',
        'accounting',
        'viewer'
      )
  )
);

CREATE POLICY budget_combinations_insert_fix ON public.budget_combinations
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.tenant_id = budget_combinations.tenant_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
);

CREATE POLICY budget_combinations_update_fix ON public.budget_combinations
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.tenant_id = budget_combinations.tenant_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.tenant_id = budget_combinations.tenant_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
);

CREATE POLICY budget_combinations_delete_fix ON public.budget_combinations
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.tenant_id = budget_combinations.tenant_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
);

-- Child lines: visibility via parent budget tenant
CREATE POLICY budget_revenue_lines_select_fix ON public.budget_revenue_lines
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.budgets b
    JOIN public.memberships m ON m.tenant_id = b.tenant_id AND m.user_id = auth.uid()
    WHERE b.id = budget_revenue_lines.budget_id
      AND lower(trim(coalesce(m.role::text, ''))) IN (
        'owner',
        'manager',
        'customer_service',
        'accounting',
        'viewer'
      )
  )
);

CREATE POLICY budget_revenue_lines_insert_fix ON public.budget_revenue_lines
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.budgets b
    JOIN public.memberships m ON m.tenant_id = b.tenant_id AND m.user_id = auth.uid()
    WHERE b.id = budget_revenue_lines.budget_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
);

CREATE POLICY budget_revenue_lines_update_fix ON public.budget_revenue_lines
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.budgets b
    JOIN public.memberships m ON m.tenant_id = b.tenant_id AND m.user_id = auth.uid()
    WHERE b.id = budget_revenue_lines.budget_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.budgets b
    JOIN public.memberships m ON m.tenant_id = b.tenant_id AND m.user_id = auth.uid()
    WHERE b.id = budget_revenue_lines.budget_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
);

CREATE POLICY budget_revenue_lines_delete_fix ON public.budget_revenue_lines
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.budgets b
    JOIN public.memberships m ON m.tenant_id = b.tenant_id AND m.user_id = auth.uid()
    WHERE b.id = budget_revenue_lines.budget_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
);

CREATE POLICY budget_cost_lines_select_fix ON public.budget_cost_lines
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.budgets b
    JOIN public.memberships m ON m.tenant_id = b.tenant_id AND m.user_id = auth.uid()
    WHERE b.id = budget_cost_lines.budget_id
      AND lower(trim(coalesce(m.role::text, ''))) IN (
        'owner',
        'manager',
        'customer_service',
        'accounting',
        'viewer'
      )
  )
);

CREATE POLICY budget_cost_lines_insert_fix ON public.budget_cost_lines
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.budgets b
    JOIN public.memberships m ON m.tenant_id = b.tenant_id AND m.user_id = auth.uid()
    WHERE b.id = budget_cost_lines.budget_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
);

CREATE POLICY budget_cost_lines_update_fix ON public.budget_cost_lines
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.budgets b
    JOIN public.memberships m ON m.tenant_id = b.tenant_id AND m.user_id = auth.uid()
    WHERE b.id = budget_cost_lines.budget_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.budgets b
    JOIN public.memberships m ON m.tenant_id = b.tenant_id AND m.user_id = auth.uid()
    WHERE b.id = budget_cost_lines.budget_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
);

CREATE POLICY budget_cost_lines_delete_fix ON public.budget_cost_lines
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND lower(trim(coalesce(m.role::text, ''))) = 'super_admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.budgets b
    JOIN public.memberships m ON m.tenant_id = b.tenant_id AND m.user_id = auth.uid()
    WHERE b.id = budget_cost_lines.budget_id
      AND lower(trim(coalesce(m.role::text, ''))) IN ('owner', 'manager')
  )
);

COMMENT ON TABLE public.budgets IS 'Budget versions per tenant/property; bootstrap via sql/budget_fix_bootstrap.sql';
COMMENT ON TABLE public.budget_combinations IS 'Saved property groupings for consolidated budget view';
