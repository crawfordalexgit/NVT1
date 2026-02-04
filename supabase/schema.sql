-- supabase/schema.sql
-- Idempotent schema for snapshot persistence

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Runs table: one row per snapshot run
CREATE TABLE IF NOT EXISTS snapshot_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_iso date UNIQUE,
  generated_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb DEFAULT '{}'
);

-- Snapshot entries: flattened snapshot rows for each event/age/sex/run
CREATE TABLE IF NOT EXISTS snapshot_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES snapshot_runs(run_id) ON DELETE CASCADE,
  key text NOT NULL,
  tiref text,
  name text,
  club text,
  rank integer,
  time double precision,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
  -- Note: can't use expressions in a table-level UNIQUE constraint (Postgres syntax error).
  -- We'll create a unique functional index for the COALESCE expression after the table definition.
  
);

CREATE TABLE IF NOT EXISTS top50_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES snapshot_runs(run_id) ON DELETE CASCADE,
  key text NOT NULL,
  position integer NOT NULL,
  name text,
  tiref text,
  time double precision,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, key, position)
);

-- Swimmer personal bests (optional timeline store)
CREATE TABLE IF NOT EXISTS swimmer_personal_bests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tiref text,
  name text,
  run_id uuid REFERENCES snapshot_runs(run_id) ON DELETE SET NULL,
  pb_date date,
  time double precision,
  meet text,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tiref, pb_date, time)
);

-- Report cache table for storing serialized report outputs
CREATE TABLE IF NOT EXISTS report_cache (
  cache_key text PRIMARY KEY,
  value jsonb NOT NULL,
  expires_at timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_snapshot_entries_tiref ON snapshot_entries(tiref);
CREATE INDEX IF NOT EXISTS idx_snapshot_entries_name ON snapshot_entries((lower(name)));
CREATE INDEX IF NOT EXISTS idx_snapshot_runs_generated_at ON snapshot_runs(generated_at);
CREATE INDEX IF NOT EXISTS idx_top50_key_run ON top50_rankings(key, run_id);
-- Unique index to enforce one entry per (run_id, key, COALESCE(tiref,name))
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshot_entries_run_key_coalesce ON snapshot_entries (run_id, key, (COALESCE(tiref, name)));

-- Persisted monthly virtual ranking / cutoff data for use by the Virtual Rankings UI
CREATE TABLE IF NOT EXISTS virtual_monthly_cutoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL, -- event|age|sex
  month text NOT NULL, -- YYYY-MM
  cutoff double precision,
  reason text,
  ranking jsonb DEFAULT '[]'::jsonb, -- array of { name, tiref, time }
  run_id uuid REFERENCES snapshot_runs(run_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, month)
);

CREATE INDEX IF NOT EXISTS idx_virtual_month_key ON virtual_monthly_cutoffs(key, month);

-- Table to persist dry-run or staged event PB imports for inspection
CREATE TABLE IF NOT EXISTS event_pbs_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES snapshot_runs(run_id) ON DELETE SET NULL,
  key text NOT NULL,
  event text,
  age text,
  sex text,
  would_store integer,
  sample jsonb DEFAULT '[]'::jsonb,
  payload jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_pbs_key ON event_pbs_imports(key);

-- Canonical per-event personal bests table (typed columns for efficient queries)
CREATE TABLE IF NOT EXISTS event_personal_bests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tiref text,
  name text,
  event text,
  age text,
  sex text,
  rank integer,
  club text,
  yob integer,
  venue text,
  level text,
  pb_date date,
  time double precision,
  meet text,
  payload jsonb DEFAULT '{}'::jsonb,
  run_id uuid REFERENCES snapshot_runs(run_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tiref, event, pb_date, time)
);

CREATE INDEX IF NOT EXISTS idx_event_personal_bests_tiref ON event_personal_bests(tiref);
CREATE INDEX IF NOT EXISTS idx_event_personal_bests_event ON event_personal_bests(event);
CREATE INDEX IF NOT EXISTS idx_event_personal_bests_pb_date ON event_personal_bests(pb_date);
