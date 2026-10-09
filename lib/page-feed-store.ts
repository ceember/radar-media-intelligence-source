import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { getDb, type DB } from './db';
import { generatedFeedSources, generatedFeedItems } from './db/schema';
import { FEED_PARSER, pageFeedFailure, type FeedSelectors, type PageFeedItem } from './feed-from-page';

export type PageFeedSource = typeof generatedFeedSources.$inferSelect;
export function pageFeedInterrupted(source: PageFeedSource | null, now = Date.now()): boolean {
  return Boolean(source?.status === 'reading' && source.nextFetchAt
    && source.nextFetchAt.getTime() - 3_600_000 < now - 120_000);
}
export async function pageFeedSource(projectId: number, db?: DB) {
  return (await (db ?? await getDb()).select().from(generatedFeedSources).where(eq(generatedFeedSources.projectId,projectId)).limit(1))[0] ?? null;
}
export async function pageFeedItems(source: PageFeedSource, db?: DB) {
  if (source.status !== 'ready' || !source.checkedAt) return [];
  return (db ?? await getDb()).select().from(generatedFeedItems)
    .where(and(eq(generatedFeedItems.projectId,source.projectId),eq(generatedFeedItems.sourceUrl,source.url),
      eq(generatedFeedItems.sourceRevision,source.revision),eq(generatedFeedItems.verifiedAt,source.checkedAt)))
    .orderBy(desc(generatedFeedItems.observedAt),desc(generatedFeedItems.id)).limit(50);
}

export async function savePageFeed(projectId: number, input: {name:string;url:string;selectors:FeedSelectors}, db?: DB): Promise<boolean> {
  const store = db ?? await getDb(), existing = await pageFeedSource(projectId,store);
  if (existing) {
    await store.update(generatedFeedSources).set({ ...input, permissionAt:new Date(), savedAt:new Date(),
      revision:sql`${generatedFeedSources.revision} + 1`, parser:FEED_PARSER,status:'pending',error:null })
      .where(and(eq(generatedFeedSources.id,existing.id),eq(generatedFeedSources.projectId,projectId)));
    return true;
  }
  for (let attempt=0;attempt<20;attempt++) {
    const result = await store.execute(sql`INSERT INTO generated_feed_sources(id,project_id,name,url,selectors,permission_at,parser)
      SELECT slot,${projectId},${input.name},${input.url},${JSON.stringify(input.selectors)}::jsonb,CURRENT_TIMESTAMP,${FEED_PARSER}
      FROM generate_series(1,20) AS slot
      WHERE NOT EXISTS(SELECT 1 FROM generated_feed_sources WHERE id=slot)
      ORDER BY slot LIMIT 1 ON CONFLICT DO NOTHING RETURNING id`);
    if (result.rows.length) return true;
    const concurrent = await pageFeedSource(projectId,store);
    if (concurrent) {
      await store.update(generatedFeedSources).set({ ...input, permissionAt:new Date(), savedAt:new Date(),
        revision:sql`${generatedFeedSources.revision} + 1`, parser:FEED_PARSER,status:'pending', error:null })
        .where(and(eq(generatedFeedSources.id,concurrent.id),eq(generatedFeedSources.projectId,projectId)));
      return true;
    }
    const [{count}] = await store.select({count:sql<number>`count(*)`}).from(generatedFeedSources);
    if (Number(count)>=20) return false;
  }
  return false;
}

export async function claimPageFeedRefresh(projectId: number, db?: DB): Promise<PageFeedSource | null> {
  const rows = await (db ?? await getDb()).update(generatedFeedSources).set({ nextFetchAt:sql`date_trunc('milliseconds',CURRENT_TIMESTAMP) + INTERVAL '1 hour'`, status:'reading', error:null })
    .where(and(eq(generatedFeedSources.projectId,projectId),or(isNull(generatedFeedSources.nextFetchAt),sql`${generatedFeedSources.nextFetchAt} <= CURRENT_TIMESTAMP`)))
    .returning();
  return rows[0] ?? null;
}

export async function storePageFeedItems(source: PageFeedSource, items: PageFeedItem[], db?: DB): Promise<boolean> {
  const result = await (db ?? await getDb()).execute(sql`WITH current_source AS (
    UPDATE generated_feed_sources SET status='ready',error=NULL,checked_at=date_trunc('milliseconds',CURRENT_TIMESTAMP)
    WHERE id=${source.id} AND project_id=${source.projectId} AND revision=${source.revision}
      AND next_fetch_at=${source.nextFetchAt} RETURNING project_id
  ) INSERT INTO generated_feed_items(project_id,source_url,source_revision,url,url_hash,title,summary,verified_at)
    SELECT current_source.project_id,${source.url},${source.revision},item.url,item."urlHash",item.title,item.summary,date_trunc('milliseconds',CURRENT_TIMESTAMP)
    FROM current_source,jsonb_to_recordset(${JSON.stringify(items.slice(0,50))}::jsonb) AS item(url text,"urlHash" text,title text,summary text)
    ON CONFLICT(project_id,url) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, source_url=EXCLUDED.source_url,
      source_revision=EXCLUDED.source_revision, verified_at=EXCLUDED.verified_at,
      updated_at=CASE WHEN generated_feed_items.title IS DISTINCT FROM EXCLUDED.title
        OR generated_feed_items.summary IS DISTINCT FROM EXCLUDED.summary OR generated_feed_items.source_url IS DISTINCT FROM EXCLUDED.source_url
        THEN CURRENT_TIMESTAMP ELSE generated_feed_items.updated_at END
    RETURNING id`);
  return result.rows.length>0;
}
export async function failPageFeed(source: PageFeedSource, error: string, db?: DB) {
  await (db ?? await getDb()).update(generatedFeedSources).set({status:'unavailable',error:pageFeedFailure(new Error(error)),checkedAt:new Date()})
    .where(and(eq(generatedFeedSources.id,source.id),eq(generatedFeedSources.projectId,source.projectId),
      eq(generatedFeedSources.revision,source.revision),eq(generatedFeedSources.nextFetchAt,source.nextFetchAt!)));
}
