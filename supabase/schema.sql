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
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, key, COALESCE(tiref, name))
);

-- Top 50 rankings store (optional) for quick lookups
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
