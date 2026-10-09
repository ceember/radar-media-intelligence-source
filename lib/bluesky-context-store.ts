import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb, type DB } from './db';
import { fetchPublicText } from './public-http';
import { withinResearchDeadline } from './web-research';
import { BLUESKY_PUBLIC_HOST, blueskyMentionIds, blueskyPostUri, blueskyThreadEndpoint, readBlueskyThread } from './bluesky-context';
import type { BlueskyContextReason, BlueskyContextSnapshot, SavedBlueskyContext } from './bluesky-context-types';

type CacheRow = {
  mention_id: number; root_uri: string; status: SavedBlueskyContext['status']; reason: BlueskyContextReason;
  snapshot: BlueskyContextSnapshot | null; attempted_at: Date | string; expires_at: Date | string;
};
export type ContextSelection = { mentionId: number; uri: string };
export type ContextClaim = ContextSelection & { projectId: number; claimId: string };
type ContextDependencies = { db?: DB; fetchPage?: typeof fetchPublicText };

function savedContext(row: CacheRow): SavedBlueskyContext {
  const attempted = row.attempted_at instanceof Date ? row.attempted_at : new Date(row.attempted_at);
  const expires = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  const interrupted = row.status === 'reading' && attempted.getTime() < Date.now()-120_000;
  return { mentionId:Number(row.mention_id),status:interrupted ? 'unavailable' : row.status,
    reason:interrupted ? 'fetch_failed' : row.reason,snapshot:row.status==='ready' ? row.snapshot : null,
    attemptedAt:attempted.toISOString(),expiresAt:expires.toISOString(),expired:expires.getTime() <= Date.now() };
}

export async function selectBlueskyMentions(projectId: number,ids: number[],db?: DB): Promise<ContextSelection[]> {
  blueskyMentionIds(ids);
  const result = await (db ?? await getDb()).execute(sql`SELECT id,external_id FROM mentions
    WHERE project_id=${projectId} AND id IN (${sql.join(ids.map(id => sql`${id}`),sql`,`)})
      AND source='bluesky' AND kind='post' AND import_file_id IS NULL`);
  const selected = new Map(result.rows.map(row => [Number(row.id),String(row.external_id)]));
  return ids.flatMap(mentionId => {
    const uri = blueskyPostUri(selected.get(mentionId));
    return uri ? [{ mentionId,uri }] : [];
  });
}

export async function savedBlueskyContext(projectId: number,mentionId: number,db?: DB): Promise<SavedBlueskyContext | null> {
  const result = await (db ?? await getDb()).execute(sql`SELECT c.mention_id,c.root_uri,c.status,c.reason,c.snapshot,c.attempted_at,c.expires_at
    FROM bluesky_context_cache c JOIN mentions m ON m.id=c.mention_id AND m.project_id=c.project_id AND m.external_id=c.root_uri
    WHERE c.project_id=${projectId} AND c.mention_id=${mentionId}
      AND m.source='bluesky' AND m.kind='post' AND m.import_file_id IS NULL LIMIT 1`);
  return result.rows[0] ? savedContext(result.rows[0] as unknown as CacheRow) : null;
}

export async function blueskyContextCoolingDown(db?: DB): Promise<boolean> {
  return (await (db ?? await getDb()).execute(sql`SELECT id FROM bluesky_context_cooldown
    WHERE id=1 AND blocked_until>CURRENT_TIMESTAMP`)).rows.length > 0;
}

export async function claimBlueskyContext(projectId: number,selection: ContextSelection,db?: DB): Promise<ContextClaim | null> {
  if (!blueskyPostUri(selection.uri)) return null;
  const claimId = randomUUID();
  const result = await (db ?? await getDb()).execute(sql`INSERT INTO bluesky_context_cache
    (project_id,mention_id,root_uri,claim_id,status,reason,attempted_at,expires_at)
    SELECT ${projectId},m.id,m.external_id,${claimId},'reading','reading',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+INTERVAL '24 hours'
    FROM mentions m WHERE m.id=${selection.mentionId} AND m.project_id=${projectId} AND m.external_id=${selection.uri}
      AND m.source='bluesky' AND m.kind='post' AND m.import_file_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM bluesky_context_cooldown WHERE id=1 AND blocked_until>CURRENT_TIMESTAMP)
    ON CONFLICT(project_id,mention_id) DO UPDATE SET root_uri=EXCLUDED.root_uri,claim_id=EXCLUDED.claim_id,
      status='reading',reason='reading',attempted_at=EXCLUDED.attempted_at,expires_at=EXCLUDED.expires_at,completed_at=NULL
    WHERE bluesky_context_cache.expires_at<=CURRENT_TIMESTAMP OR bluesky_context_cache.root_uri<>EXCLUDED.root_uri
    RETURNING mention_id`);
  return result.rows.length ? { ...selection,projectId,claimId } : null;
}

export async function completeBlueskyContext(claim: ContextClaim,snapshot: BlueskyContextSnapshot | null,reason: BlueskyContextReason,db?: DB): Promise<boolean> {
  if (snapshot && snapshot.rootUri !== claim.uri) return false;
  const status = reason==='rate_limited' ? 'throttled' : snapshot?.status ?? 'unavailable';
  const result = await (db ?? await getDb()).execute(sql`UPDATE bluesky_context_cache c
    SET status=${status},reason=${reason},snapshot=${snapshot ? JSON.stringify(snapshot) : null}::jsonb,
      completed_at=CURRENT_TIMESTAMP,expires_at=CURRENT_TIMESTAMP+INTERVAL '24 hours'
    WHERE c.project_id=${claim.projectId} AND c.mention_id=${claim.mentionId} AND c.root_uri=${claim.uri} AND c.claim_id=${claim.claimId}
      AND EXISTS(SELECT 1 FROM mentions m WHERE m.id=c.mention_id AND m.project_id=c.project_id AND m.external_id=c.root_uri
        AND m.source='bluesky' AND m.kind='post' AND m.import_file_id IS NULL)
    RETURNING mention_id`);
  return result.rows.length > 0;
}

export async function stopBlueskyContextReading(db?: DB): Promise<void> {
  await (db ?? await getDb()).execute(sql`INSERT INTO bluesky_context_cooldown(id,blocked_until)
    VALUES(1,CURRENT_TIMESTAMP+INTERVAL '1 hour') ON CONFLICT(id) DO UPDATE
      SET blocked_until=GREATEST(bluesky_context_cooldown.blocked_until,EXCLUDED.blocked_until)`);
}

export async function refreshBlueskyContexts(projectId: number,ids: number[],deadline: number,dependencies: ContextDependencies = {}) {
  const wait = <Value>(work: PromiseLike<Value>) => withinResearchDeadline(work,deadline);
  const db = dependencies.db ?? await wait(getDb());
  const selections = await wait(selectBlueskyMentions(projectId,ids,db));
  if (selections.length !== ids.length) return { status:404,error:'Select existing public Bluesky posts from the current project.' };
  const contexts: SavedBlueskyContext[] = [];
  for (const selection of selections) {
    if (Date.now() > deadline-17_000) return { status:200,contexts,stopped:true,reason:'time_limit' };
    const cached = await wait(savedBlueskyContext(projectId,selection.mentionId,db));
    if (cached && !cached.expired) { contexts.push(cached); continue; }
    if (await wait(blueskyContextCoolingDown(db))) return { status:429,contexts,stopped:true,reason:'rate_limited' };
    const claim = await wait(claimBlueskyContext(projectId,selection,db));
    if (!claim) {
      const saved = await wait(savedBlueskyContext(projectId,selection.mentionId,db));
      if (saved) contexts.push(saved);
      if (!saved && await wait(blueskyContextCoolingDown(db))) return { status:429,contexts,stopped:true,reason:'rate_limited' };
      continue;
    }
    let snapshot: BlueskyContextSnapshot | null = null;
    let reason: BlueskyContextReason = 'fetch_failed';
    try {
      const page = await withinResearchDeadline((dependencies.fetchPage ?? fetchPublicText)(blueskyThreadEndpoint(claim.uri),{
        allowedHostname:BLUESKY_PUBLIC_HOST,maxRedirects:0,maxBytes:1_000_000,timeoutMs:12_000,
        headers:{ Accept:'application/json','Accept-Encoding':'identity','User-Agent':'RadarBot/1.0' },
      }),deadline-5000);
      if (!page.contentType.toLowerCase().includes('application/json') || Buffer.byteLength(page.text)>1_000_000) {
        reason = 'invalid_thread';
      } else {
        try { snapshot = readBlueskyThread(JSON.parse(page.text),claim.uri,new Date().toISOString()); }
        catch { reason = 'invalid_thread'; }
        if (snapshot) reason = snapshot.status==='ready' ? 'ready' : snapshot.status==='moderated' ? 'moderated' : 'thread_unavailable';
      }
    } catch (error) {
      if (error instanceof Error && error.message==='Public HTTP status 429') reason = 'rate_limited';
    }
    if (reason==='rate_limited') await wait(stopBlueskyContextReading(db));
    if (!await wait(completeBlueskyContext(claim,snapshot,reason,db))) {
      return { status:409,contexts,error:'The selected post or reading claim changed. Reload saved context.' };
    }
    const saved = await wait(savedBlueskyContext(projectId,selection.mentionId,db));
    if (saved) contexts.push(saved);
    if (reason==='rate_limited') return { status:429,contexts,stopped:true,reason:'rate_limited' };
  }
  return { status:200,contexts,stopped:false };
}
