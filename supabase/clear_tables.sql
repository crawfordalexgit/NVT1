-- WARNING: Destructive. Backup first (export or run SELECT counts below).
-- Run this in the Supabase SQL editor (recommended) or via psql.

BEGIN;

TRUNCATE TABLE public.event_personal_bests RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.event_pbs_imports RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.virtual_monthly_cutoffs RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.report_cache RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.swimmer_personal_bests RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.top50_rankings RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.snapshot_entries RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.snapshot_runs RESTART IDENTITY CASCADE;

-- Verify counts after truncate
SELECT
  (SELECT count(*) FROM public.snapshot_runs) AS snapshot_runs,
  (SELECT count(*) FROM public.snapshot_entries) AS snapshot_entries,
  (SELECT count(*) FROM public.top50_rankings) AS top50_rankings,
  (SELECT count(*) FROM public.swimmer_personal_bests) AS swimmer_personal_bests,
  (SELECT count(*) FROM public.report_cache) AS report_cache,
  (SELECT count(*) FROM public.virtual_monthly_cutoffs) AS virtual_monthly_cutoffs,
  (SELECT count(*) FROM public.event_pbs_imports) AS event_pbs_imports,
  (SELECT count(*) FROM public.event_personal_bests) AS event_personal_bests;

COMMIT;