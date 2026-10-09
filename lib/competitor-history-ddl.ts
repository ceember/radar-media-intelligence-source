export const ARCHIVE_DDL = [
  `CREATE TABLE IF NOT EXISTS competitor_archive_selection (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    page_ids JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(page_ids)='array' AND jsonb_array_length(page_ids)<=5),
    selected_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS competitor_archive_usage (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,utc_day DATE NOT NULL,
    attempts INTEGER NOT NULL,PRIMARY KEY(project_id,utc_day))`,
  `CREATE TABLE IF NOT EXISTS competitor_archive_lookups (
    id SERIAL PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    page_id INTEGER NOT NULL REFERENCES competitor_pages(id) ON DELETE CASCADE,source_url TEXT NOT NULL,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),status TEXT NOT NULL DEFAULT 'unknown',records JSONB,
    message TEXT NOT NULL DEFAULT 'Archive lookup reserved; no completed index result recorded.')`,
  `CREATE INDEX IF NOT EXISTS competitor_archive_scope ON competitor_archive_lookups(project_id,page_id,source_url,checked_at DESC)`,
  `ALTER TABLE competitor_archive_lookups ADD COLUMN IF NOT EXISTS failure_category TEXT
    CHECK(failure_category IN ('http','timeout','connection','dns','size','encoding','parse','redirect','guard','interrupted','quota','unknown'))`,
  `ALTER TABLE competitor_archive_lookups ADD COLUMN IF NOT EXISTS http_status_class TEXT
    CHECK(http_status_class IN ('1xx','2xx','3xx','4xx','5xx','other'))`,
  `ALTER TABLE competitor_archive_lookups ADD COLUMN IF NOT EXISTS elapsed_ms INTEGER CHECK(elapsed_ms>=0)`,
  `ALTER TABLE competitor_archive_lookups ADD COLUMN IF NOT EXISTS transport_elapsed_ms INTEGER CHECK(transport_elapsed_ms>=0)`,
  `ALTER TABLE competitor_archive_lookups ADD COLUMN IF NOT EXISTS background_started_at TIMESTAMPTZ`,
  `ALTER TABLE competitor_archive_lookups ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  // Preserve earlier duplicate attempts as Unknown before installing the single-running-job constraint.
  `UPDATE competitor_archive_lookups SET status='unknown',records=NULL,message='Duplicate archive start superseded; no completed index recorded.'
    WHERE id IN (SELECT id FROM (SELECT id,row_number() OVER(PARTITION BY project_id,page_id,source_url ORDER BY checked_at DESC,id DESC) AS position
      FROM competitor_archive_lookups WHERE status='running') duplicates WHERE position>1)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS competitor_archive_running ON competitor_archive_lookups(project_id,page_id,source_url) WHERE status='running'`,
];
