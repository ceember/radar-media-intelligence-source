import 'server-only';
import { sql } from 'drizzle-orm';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { DB } from './index';

export const SCHEMA_BOOTSTRAP_LOCK = [0x52414441, 0x5343484d] as const;

export async function bootstrapSchema(db: DB, statements: readonly string[], neonClient?: NeonQueryFunction<false, false>) {
  if (neonClient) {
    await neonClient.transaction(transaction => [
      transaction.query('SELECT pg_advisory_xact_lock($1, $2)', [...SCHEMA_BOOTSTRAP_LOCK]),
      ...statements.map(statement => transaction.query(statement)),
    ], { isolationLevel: 'ReadCommitted', readOnly: false });
    return;
  }
  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}
