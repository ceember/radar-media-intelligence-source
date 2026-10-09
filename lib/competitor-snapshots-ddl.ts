export const COMPETITOR_DDL = [
  `CREATE TABLE IF NOT EXISTS competitor_entities (
    id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL, UNIQUE(project_id,name))`,
  `CREATE TABLE IF NOT EXISTS competitor_pages (
    id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    entity_id INTEGER NOT NULL REFERENCES competitor_entities(id),
    slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 10), entity TEXT NOT NULL, label TEXT NOT NULL, url TEXT NOT NULL,
    UNIQUE (project_id, slot), UNIQUE (project_id, url))`,
  `CREATE TABLE IF NOT EXISTS competitor_daily_usage (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    utc_day DATE NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY (project_id, utc_day))`,
  `CREATE TABLE IF NOT EXISTS competitor_snapshots (
    id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    page_id INTEGER NOT NULL REFERENCES competitor_pages(id) ON DELETE CASCADE,
    entity_id INTEGER NOT NULL REFERENCES competitor_entities(id),
    source_url TEXT NOT NULL, captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'unknown', normalized_text TEXT, text_hash TEXT, raw_html TEXT,
    evidence JSONB, error TEXT DEFAULT 'Capture reserved; no completed page result recorded.')`,
  `CREATE INDEX IF NOT EXISTS competitor_snapshot_scope ON competitor_snapshots (project_id, page_id, captured_at DESC)`,
  `CREATE TABLE IF NOT EXISTS competitor_robots (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, origin TEXT NOT NULL, utc_day DATE NOT NULL,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(), body TEXT, error TEXT,
    next_allowed_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (project_id, origin, utc_day))`,
  `ALTER TABLE competitor_robots ADD COLUMN IF NOT EXISTS http_status INTEGER`,
  `ALTER TABLE competitor_snapshots ADD COLUMN IF NOT EXISTS offers JSONB`,
  `CREATE TABLE IF NOT EXISTS competitor_offer_reviews (
    id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    snapshot_id INTEGER NOT NULL REFERENCES competitor_snapshots(id) ON DELETE CASCADE,
    offer_id TEXT NOT NULL, field TEXT NOT NULL, corrected_value TEXT,
    note TEXT NOT NULL, reviewed_by INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS competitor_offer_review_scope ON competitor_offer_reviews (project_id,snapshot_id,id DESC)`,
];
