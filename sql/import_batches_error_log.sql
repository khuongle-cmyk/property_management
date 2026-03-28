-- Persist per-row import failures for debugging (JSON array: [{ "row": 1, "error": "..." }, ...])
alter table public.import_batches
  add column if not exists error_log jsonb;
