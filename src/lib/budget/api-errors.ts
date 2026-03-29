/** JSON body helper when PostgREST fails (missing table/column, etc.). */
export function budgetApiErrorPayload(message: string) {
  const hint =
    /relation|does not exist|column/i.test(message)
      ? "Run sql/budget_fix_bootstrap.sql in the Supabase SQL editor if budget tables or columns are missing."
      : undefined;
  return hint ? { error: message, hint } : { error: message };
}
