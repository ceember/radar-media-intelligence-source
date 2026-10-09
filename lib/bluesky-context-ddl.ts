export const BLUESKY_CONTEXT_DDL = [
  `CREATE TABLE IF NOT EXISTS bluesky_context_cache (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    mention_id INTEGER NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
    root_uri TEXT NOT NULL, claim_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('reading','ready','unavailable','moderated','throttled')),
    reason TEXT NOT NULL CHECK (reason IN ('reading','ready','thread_unavailable','moderated','invalid_thread','fetch_failed','rate_limited')),
    snapshot JSONB, attempted_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL, UNIQUE(project_id,mention_id)
  )`,
  `CREATE TABLE IF NOT EXISTS bluesky_context_cooldown (
    id INTEGER PRIMARY KEY CHECK (id=1), blocked_until TIMESTAMPTZ NOT NULL
  )`,
];
