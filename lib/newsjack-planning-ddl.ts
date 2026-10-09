export const NEWSJACK_PLANNING_DDL=[
 `CREATE TABLE IF NOT EXISTS newsjack_planning_runs (
  id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('crisis','calendar','coverage','journalists')),
  input TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'running', result JSONB, error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`,
 `CREATE INDEX IF NOT EXISTS newsjack_planning_runs_project ON newsjack_planning_runs(project_id,created_at DESC)`,
 `CREATE TABLE IF NOT EXISTS newsjack_coverage_config (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`,
 `CREATE TABLE IF NOT EXISTS newsjack_coverage_decisions (
  id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  config_hash TEXT NOT NULL, url_hash TEXT NOT NULL, decision JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(project_id,config_hash,url_hash)
 )`,
 `CREATE TABLE IF NOT EXISTS newsjack_coverage_alerted (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, url_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(project_id,url_hash)
 )`,
];
