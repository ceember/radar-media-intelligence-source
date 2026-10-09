export const ADS_EVIDENCE_DDL = [
  `CREATE TABLE IF NOT EXISTS competitor_ad_observations (
    id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    benchmark_id INTEGER NOT NULL,
    brand_name TEXT NOT NULL, brand_domain TEXT NOT NULL, observed_by INTEGER NOT NULL,
    checked_date DATE NOT NULL, platform TEXT NOT NULL CHECK(platform IN ('meta','google')),
    ad_count INTEGER CHECK(ad_count>=0 AND ad_count<=1000000), message_offer TEXT NOT NULL,
    landing_url TEXT, note TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS competitor_ad_observation_scope ON competitor_ad_observations(project_id,benchmark_id,checked_date DESC,id DESC)`,
];
