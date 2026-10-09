export const PAGESPEED_DDL = [
  `CREATE TABLE IF NOT EXISTS competitor_pagespeed_usage (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, utc_day DATE NOT NULL,
    attempts INTEGER NOT NULL, PRIMARY KEY(project_id,utc_day))`,
  `CREATE TABLE IF NOT EXISTS competitor_pagespeed_audits (
    id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    page_id INTEGER NOT NULL REFERENCES competitor_pages(id) ON DELETE CASCADE,
    entity_id INTEGER NOT NULL REFERENCES competitor_entities(id), source_url TEXT NOT NULL,
    strategy TEXT NOT NULL CHECK(strategy IN ('mobile','desktop')), checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'unknown', result JSONB, message TEXT NOT NULL DEFAULT 'Audit reserved; no completed lab result recorded.')`,
  `CREATE INDEX IF NOT EXISTS competitor_pagespeed_scope ON competitor_pagespeed_audits(project_id,page_id,strategy,checked_at DESC)`,
  `ALTER TABLE competitor_pagespeed_audits ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'google' CHECK(provider IN ('google','f9'))`,
];
