import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getInitializedDb } from '@/lib/db';
import { benchmarkEntities, mentions, projects } from '@/lib/db/schema';
import { preflight, runNarrow, type Config, type Env, type NewRow } from '@/lib/public-ingest-core';
import { fetchNarrowHn, fetchNarrowRss } from '@/lib/public-ingest-adapters';
import { hashProjectRows, saveProjectSnapshot, verifyPublicActivation,
  withPublicDayLease } from '@/lib/public-ingest-custody';
import { isPublicAddress } from '@/lib/public-http';
import { emptyPostBody, configuredPublicIngestOrigin } from '@/lib/public-ingest-request';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !/^[a-f0-9]{64,}$/.test(secret) || !header) return false;
  const received = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** One project, one attempt, RSS+HN only. OPS holds cron.lock and a foreground ceiling. */
export async function POST(req: Request) {
  const app = process.env.APP_URL;
  let target: URL;
  try { target = new URL(req.url); } catch { return NextResponse.json({ error: 'HOLD' }, { status: 400 }); }
  if (!configuredPublicIngestOrigin(app, process.env.RADAR_PUBLIC_INGEST_ORIGIN) || target.origin !== app
      || target.pathname !== '/api/cron/public-ingest' || target.search || target.hash
      || !authorized(req.headers.get('authorization'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'HOLD' }, { status: 401 });
  if (!await emptyPostBody(req)) return NextResponse.json({ error: 'HOLD' }, { status: 400 });

  try {
    const config: Config = {
      projectId: Number(process.env.RADAR_PUBLIC_INGEST_PROJECT_ID),
      ownerId: Number(process.env.RADAR_PUBLIC_INGEST_OWNER_ID),
      projectName: 'SYNTHETIC_SCHEDULER26',
      keyword: process.env.RADAR_PUBLIC_INGEST_KEYWORD ?? '',
      rssUrl: process.env.RADAR_PUBLIC_INGEST_RSS_URL ?? '',
      candidateSha256: process.env.RADAR_PUBLIC_INGEST_CANDIDATE_SHA256 ?? '',
    };
    // This gate runs before getDb, which can initialize/seed in DEMO_MODE.
    if (process.env.DEMO_MODE !== undefined || process.env.DATABASE_URL
        || process.env.RADAR_RETENTION_DISABLED !== '1') throw new Error('HOLD');
    const custody = {
      receiptDir: process.env.RADAR_PUBLIC_INGEST_RECEIPT_DIR ?? '',
      candidateSha256: config.candidateSha256, projectId: config.projectId,
      ownerId: config.ownerId, rssUrl: config.rssUrl, keyword: config.keyword,
      now: () => new Date(),
    };
    // Missing/mismatched one-time cold backup/drill approval refuses before DB initialization.
    await verifyPublicActivation(custody);
    const db = getInitializedDb();
    const [project] = await db.select().from(projects).where(eq(projects.id, config.projectId));
    if (!project) throw new Error('HOLD');
    preflight(process.env as Env, project, config);
    let baselineHash = '';
    const result = await runNarrow(process.env as Env, project, config, {
      now: () => new Date(), isPublicAddress,
      noBenchmarkEntities: async (projectId) => {
        const rows = await db.select({ id: benchmarkEntities.id }).from(benchmarkEntities)
          .where(eq(benchmarkEntities.projectId, projectId)).limit(1);
        return rows.length === 0;
      },
      withDailyLease: async (_projectId, day, work) => withPublicDayLease(custody, day, work),
      verifySnapshot: async () => {
        const rows = await db.select().from(mentions).where(eq(mentions.projectId, config.projectId))
          .orderBy(mentions.id).limit(501);
        const snapshot = await saveProjectSnapshot(custody, custody.now().toISOString().slice(0, 10), rows);
        baselineHash = snapshot.dataSha256;
        return snapshot;
      },
      fetchRss: fetchNarrowRss, fetchHn: fetchNarrowHn,
      insertNew: async (rows: NewRow[]) => db.transaction(async (tx) => {
        const current = await tx.select().from(mentions).where(eq(mentions.projectId, config.projectId))
          .orderBy(mentions.id).limit(501);
        if (!baselineHash || hashProjectRows(current) !== baselineHash) throw new Error('HOLD');
        const keys: string[] = [];
        for (const row of rows) {
          const added = await tx.insert(mentions).values({ projectId: row.projectId,
            source: row.source, externalId: row.externalId, title: row.title,
            content: row.content, url: row.url, publishedAt: row.publishedAt, kind: row.kind,
            author: row.author, community: row.community })
            .onConflictDoNothing().returning({ source: mentions.source, externalId: mentions.externalId });
          for (const item of added) keys.push(`${item.source}\u0000${item.externalId}`);
        }
        return { inserted: keys.length, keys };
      }),
    });
    return NextResponse.json({ status: 'PASS', projectId: result.projectId,
      utcDay: result.day, sourceIds: ['rss', 'hackernews'], fetched: result.fetched,
      validUnique: result.validUnique, inserted: result.inserted,
      duplicate: result.validUnique - result.inserted,
      requestHops: result.requestHops, snapshotSha256: result.snapshotSha256 });
  } catch {
    return NextResponse.json({ error: 'HOLD' }, { status: 503 });
  }
}
