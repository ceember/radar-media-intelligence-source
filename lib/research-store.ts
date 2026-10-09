import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, type DB } from '@/lib/db';
import { researchRuns } from '@/lib/db/schema';
import { RESEARCH_DAILY_CAP } from './web-research';
import type { ResearchRun } from './web-research-types';

export function researchReservationSql(projectId: number, userId: number, question: string) {
  // One atomic statement: concurrent workers share the UTC-day cap. Failures count too.
  // DB clock avoids server timezone/clock drift. No open-test bypass and no client-supplied day.
  return sql`WITH slot AS (
    INSERT INTO research_daily_usage (utc_day, run_count)
    VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, 1)
    ON CONFLICT (utc_day) DO UPDATE SET run_count = research_daily_usage.run_count + 1
    WHERE research_daily_usage.run_count < ${RESEARCH_DAILY_CAP}
    RETURNING run_count
  ) INSERT INTO research_runs (project_id, user_id, question)
    SELECT ${projectId}, ${userId}, ${question} FROM slot RETURNING id`;
}

export async function reserveResearchRun(projectId: number, userId: number, question: string, db?: DB): Promise<number | null> {
  const result = await (db ?? await getDb()).execute(researchReservationSql(projectId, userId, question));
  const row = result.rows[0] as { id: number } | undefined;
  return row ? Number(row.id) : null;
}

export function serializeResearchRun(row: typeof researchRuns.$inferSelect): ResearchRun {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export async function researchHistory(projectId: number) {
  const db = await getDb();
  const rows = await db.select({ id: researchRuns.id, question: researchRuns.question,
    status: researchRuns.status, createdAt: researchRuns.createdAt }).from(researchRuns)
    .where(eq(researchRuns.projectId, projectId)).orderBy(desc(researchRuns.createdAt)).limit(30);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function savedResearchRun(projectId: number, id: number) {
  const [row] = await (await getDb()).select().from(researchRuns)
    .where(and(eq(researchRuns.projectId, projectId), eq(researchRuns.id, id))).limit(1);
  return row ? serializeResearchRun(row) : null;
}
