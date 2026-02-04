-- Backfill PB metadata into swimmer_personal_bests from payload JSON
-- WARNING: Run in Supabase SQL editor. Backup first.

BEGIN;

-- Add typed columns if they don't exist
ALTER TABLE public.swimmer_personal_bests
  ADD COLUMN IF NOT EXISTS rank integer,
  ADD COLUMN IF NOT EXISTS club text,
  ADD COLUMN IF NOT EXISTS yob integer,
  ADD COLUMN IF NOT EXISTS venue text,
  ADD COLUMN IF NOT EXISTS level text;

-- Update typed columns from payload JSONB where available.
-- payload->>'date' is often in DD/MM/YY or DD/MM/YYYY format; handle both.
UPDATE public.swimmer_personal_bests
SET
  rank = COALESCE((payload->>'rank')::int, rank),
  club = COALESCE(payload->>'club', club),
  yob = COALESCE(NULLIF(payload->>'yob','')::int, yob),
  venue = COALESCE(payload->>'venue', venue),
  level = COALESCE(payload->>'level', level),
  event = COALESCE(payload->>'event', event),
  pb_date = COALESCE(
    CASE WHEN payload->>'date' IS NOT NULL AND payload->>'date' <> '' THEN
      CASE WHEN char_length(payload->>'date') = 8 THEN to_date(payload->>'date','DD/MM/YY') ELSE to_date(payload->>'date','DD/MM/YYYY') END
    END,
    pb_date
  )
WHERE payload IS NOT NULL;

-- Return counts to verify results
SELECT
  count(*) AS total_rows,
  count(rank) AS has_rank,
  count(club) AS has_club,
  count(yob) AS has_yob,
  count(venue) AS has_venue,
  count(level) AS has_level,
  count(pb_date) AS has_pb_date
FROM public.swimmer_personal_bests;

COMMIT;