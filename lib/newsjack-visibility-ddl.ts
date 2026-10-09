export const NEWSJACK_VISIBILITY_DDL=[
 `CREATE TABLE IF NOT EXISTS newsjack_visibility_runs (
  id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL, input TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'running',
  result JSONB, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`,
 `CREATE INDEX IF NOT EXISTS newsjack_visibility_runs_project ON newsjack_visibility_runs(project_id,created_at DESC)`,
];
