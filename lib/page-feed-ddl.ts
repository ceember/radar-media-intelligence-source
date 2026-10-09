export const PAGE_FEED_DDL = [
  `CREATE TABLE IF NOT EXISTS generated_feed_sources (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 20),
    project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL, url TEXT NOT NULL, selectors JSONB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    permission_at TIMESTAMPTZ NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_fetch_at TIMESTAMPTZ, checked_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reading','ready','unavailable')),
    error TEXT, parser TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS generated_feed_items (
    id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    url TEXT NOT NULL, url_hash TEXT NOT NULL, source_url TEXT NOT NULL,
    source_revision INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(project_id, url)
  )`,
  `CREATE INDEX IF NOT EXISTS generated_feed_items_project_date ON generated_feed_items(project_id, observed_at DESC)`,
];
