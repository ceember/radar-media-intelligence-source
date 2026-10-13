export const REFRESH_RUN_DDL=[
 `CREATE TABLE IF NOT EXISTS refresh_runs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('refresh','cron')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','complete','failed')),
  counters JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(counters)='array'),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
 )`,
 `CREATE INDEX IF NOT EXISTS refresh_runs_project_started ON refresh_runs(project_id,started_at DESC)`,
];
