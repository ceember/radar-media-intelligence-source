import { sql } from 'drizzle-orm';
import { getDb, type DB } from './db';

export function readerReservationSql() {
  // ponytail: one deployment-wide lane (10/minute); add per-source lanes only if throughput requires them.
  // DB UTC clock and an atomic increment; failed/uncertain calls consume slots, including open-test mode.
  return sql`INSERT INTO article_reader_usage (utc_day, request_count, last_request_at)
    VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, 1, CURRENT_TIMESTAMP)
    ON CONFLICT (utc_day) DO UPDATE SET request_count = article_reader_usage.request_count + 1,
      last_request_at = CURRENT_TIMESTAMP
    WHERE article_reader_usage.request_count < 100
      AND article_reader_usage.last_request_at <= CURRENT_TIMESTAMP - INTERVAL '6 seconds'
    RETURNING request_count`;
}
export async function reserveReaderRequest(db?: DB): Promise<boolean> {
  return (await (db ?? await getDb()).execute(readerReservationSql())).rows.length === 1;
}
