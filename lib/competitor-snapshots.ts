import { sql } from 'drizzle-orm';
import { cleanStoredText } from './text-clean';
import { getDb, type DB } from '@/lib/db';
import { fetchPublicText } from '@/lib/public-http';
import { withinResearchDeadline } from '@/lib/web-research';
import { competitorCrawlPolicy, COMPETITOR_USER_AGENT } from './competitor-crawl-policy';
import { readStructuredOffers } from './competitor-offers';
import { CAPTURE_DAILY_CAP, CAPTURE_INPUT_BYTES, competitorTextLimit, normalizeCompetitorHtml, selectedPublicUrl, utf8Bound, type CaptureEvidence, type CompetitorPage, type CompetitorSnapshot } from './competitor-page';

export async function selectedCompetitorPages(projectId: number, db?: DB): Promise<CompetitorPage[]> {
  return (await (db ?? await getDb()).execute(sql`SELECT id, project_id AS "projectId", entity_id AS "entityId", entity, label, url FROM competitor_pages WHERE project_id=${projectId} ORDER BY slot`)).rows as CompetitorPage[];
}
export async function addCompetitorPage(projectId: number, entity: string, label: string, inputUrl: string, db?: DB) {
  const url = selectedPublicUrl(inputUrl);
  entity = utf8Bound(entity.trim(), 120); label = utf8Bound(label.trim(), 120);
  if (!entity || !label) throw new Error('Enter a brand and page label.');
  const result = await (db ?? await getDb()).execute(sql`WITH free AS (
    SELECT n FROM generate_series(1,10) AS n WHERE NOT EXISTS
      (SELECT 1 FROM competitor_pages WHERE project_id=${projectId} AND slot=n) ORDER BY n LIMIT 1
  ), brand AS (
    INSERT INTO competitor_entities(project_id,name) SELECT ${projectId},${entity} FROM free
    ON CONFLICT(project_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id
  ) INSERT INTO competitor_pages(project_id,entity_id,slot,entity,label,url)
    SELECT ${projectId},brand.id,free.n,${entity},${label},${url} FROM brand CROSS JOIN free
    ON CONFLICT DO NOTHING RETURNING id`);
  return result.rows[0]?.id ?? null;
}
export function captureReservationSql(projectId: number, page: CompetitorPage) {
  return sql`WITH slot AS (INSERT INTO competitor_daily_usage (project_id,utc_day,attempts)
    VALUES (${projectId}, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, 1)
    ON CONFLICT (project_id,utc_day) DO UPDATE SET attempts=competitor_daily_usage.attempts+1
    WHERE competitor_daily_usage.attempts < ${CAPTURE_DAILY_CAP} RETURNING attempts)
    INSERT INTO competitor_snapshots (project_id,page_id,entity_id,source_url)
    SELECT ${projectId}, p.id, p.entity_id, p.url FROM slot JOIN competitor_pages p ON p.id=${page.id} AND p.project_id=${projectId} RETURNING id`;
}
export async function competitorCaptureHistory(projectId: number, pageId: number, db?: DB): Promise<CompetitorSnapshot[]> {
  const rows = (await (db ?? await getDb()).execute(sql`SELECT id,page_id AS "pageId",source_url AS "sourceUrl",captured_at AS "capturedAt",
    status,normalized_text AS text,text_hash AS hash,error,evidence,offers FROM competitor_snapshots
    WHERE project_id=${projectId} AND page_id=${pageId} AND id IN (
      (SELECT id FROM competitor_snapshots WHERE project_id=${projectId} AND page_id=${pageId} ORDER BY captured_at DESC,id DESC LIMIT 8)
      UNION
      (SELECT id FROM competitor_snapshots WHERE project_id=${projectId} AND page_id=${pageId} AND status='ok' ORDER BY captured_at DESC,id DESC LIMIT 2)
    ) ORDER BY captured_at DESC,id DESC`)).rows;
  return rows.map((r) => ({ ...r, capturedAt: new Date(r.capturedAt as string).toISOString() })) as CompetitorSnapshot[];
}
export async function captureCompetitorPage(projectId: number, pageId: number, deadline = Date.now() + 45_000) {
  const wait = <T>(p: PromiseLike<T>) => withinResearchDeadline(p, deadline);
  const db = await wait(getDb());
  const page = (await wait(selectedCompetitorPages(projectId, db))).find((p) => p.id === pageId);
  if (!page) return { status: 404, error: 'Selected page not found in this project.' };
  const url = selectedPublicUrl(page.url), origin = new URL(url).origin;
  const reservation = await wait(db.execute(captureReservationSql(projectId, page)));
  const id = reservation.rows[0]?.id as number | undefined;
  if (!id) return { status: 429, error: 'Thirty capture attempts used today. Resets at midnight UTC; failed attempts count.' };
  // A late reservation remains explicitly unknown, never an orphaned running row.
  let evidence: CaptureEvidence | null = null;
  try {
    const claim = await wait(db.execute(sql`INSERT INTO competitor_robots (project_id,origin,utc_day,error)
      VALUES (${projectId},${origin},(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,'Robots request incomplete; capture halted.')
      ON CONFLICT DO NOTHING RETURNING origin`));
    if (claim.rows.length) {
      let body: string | null = null, error: string | null = null, httpStatus: number | null = null;
      try {
        if (Date.now() >= deadline) throw new Error('Capture deadline reached.');
        const fetched = await wait(fetchPublicText(`${origin}/robots.txt`, { allowedHostname: new URL(url).hostname,
          timeoutMs: Math.min(8000, Math.max(1, deadline - Date.now())), maxBytes: 50_000, maxRedirects: 3, headers: { 'User-Agent': COMPETITOR_USER_AGENT, Accept: 'text/plain' } }));
        body = cleanStoredText(fetched.text);
        httpStatus = 200; // The strict public fetch accepts only HTTP 200.
      } catch (failure) {
        const status = failure instanceof Error ? failure.message.match(/^Public HTTP status ([45]\d{2})$/) : null;
        httpStatus = status ? Number(status[1]) : null;
        error = 'Robots fetch failed or exceeded its limit; capture halted. Retry on a later UTC day.';
      }
      await wait(db.execute(sql`UPDATE competitor_robots SET body=${body},error=${error},http_status=${httpStatus},checked_at=now(),next_allowed_at=now()+${competitorCrawlPolicy(url, body, new Date().toISOString(), error ?? undefined, httpStatus).delay}*interval '1 second'
        WHERE project_id=${projectId} AND origin=${origin} AND utc_day=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`));
    }
    const cache = (await wait(db.execute(sql`SELECT body,error,http_status AS "httpStatus",checked_at AS "checkedAt",next_allowed_at AS "nextAllowedAt" FROM competitor_robots
      WHERE project_id=${projectId} AND origin=${origin} AND utc_day=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`))).rows[0];
    const policy = competitorCrawlPolicy(url, (cache?.body as string | null) ?? null,
      new Date(cache?.checkedAt as string ?? Date.now()).toISOString(), cache?.error as string | undefined, cache?.httpStatus as number | null);
    evidence = { robots: policy };
    if (policy.status !== 'allowed') throw new Error(policy.reason);
    const remaining = new Date(cache.nextAllowedAt as string).getTime() - Date.now();
    if (remaining > 5000) throw new Error(`Crawl delay requires waiting ${policy.delay} seconds; capture deferred. Retry later.`);
    if (remaining > 0) await wait(new Promise((resolve) => setTimeout(resolve, remaining + 50)));
    const gate = await wait(db.execute(sql`UPDATE competitor_robots SET next_allowed_at=now()+${policy.delay}*interval '1 second'
      WHERE project_id=${projectId} AND origin=${origin} AND utc_day=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
      AND next_allowed_at<=now() RETURNING origin`));
    if (!gate.rows.length) throw new Error('Another capture is using this host; retry after its crawl delay.');
    if (Date.now() >= deadline) throw new Error('Capture deadline reached.');
    const response = await wait(fetchPublicText(url, { allowedHostname: new URL(url).hostname, timeoutMs: Math.min(12_000, Math.max(1, deadline - Date.now())),
      maxBytes: CAPTURE_INPUT_BYTES, maxRedirects: 0, headers: { 'User-Agent': COMPETITOR_USER_AGENT, Accept: 'text/html' } }));
    if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(response.contentType)) throw new Error('The selected URL did not return HTML; result unknown.');
    if (Buffer.byteLength(response.text) > CAPTURE_INPUT_BYTES) throw new Error('The selected HTML exceeds the decoded input limit; result unknown.');
    const normalized = normalizeCompetitorHtml(response.text, competitorTextLimit(page));
    evidence = { robots: policy, inputBytes: response.bytes, finalUrl: response.finalUrl,
      textBytes: normalized.textBytes, textLimitBytes: normalized.textLimitBytes, truncated: normalized.truncated, method: normalized.method };
    if (normalized.text.length < 80) throw new Error('Too little static page text; the page may require JavaScript. Result unknown.');
    const offers = readStructuredOffers(response.text, url, Math.min(deadline, Date.now() + 2000));
    const saved = await wait(db.execute(sql`UPDATE competitor_snapshots SET status='ok',normalized_text=${normalized.text},text_hash=${normalized.hash},
      raw_html=${cleanStoredText(response.text)},evidence=${JSON.stringify(evidence)}::jsonb,offers=${JSON.stringify(offers)}::jsonb,error=NULL
      WHERE id=${id} AND project_id=${projectId} AND page_id=${pageId} AND clock_timestamp()<${new Date(deadline).toISOString()}::timestamptz RETURNING id`));
    if (!saved.rows.length) throw Error('Capture deadline reached before saving.');
    return { status: 200, id, captureStatus: 'ok', message: normalized.truncated ? `Partial capture saved (${normalized.textLimitBytes / 1000} KB text limit).` : 'Capture saved.' };
  } catch (error) {
    const message = error instanceof Error && /^(Robots|Disallowed|Crawl|Another|Too little|The selected)/.test(error.message)
      ? error.message : 'Page fetch failed, was rate limited or exceeded its limit. Result unknown; retry on a later refresh.';
    // Final saving has a small independent budget; the initial unknown row survives any DB outage.
    try { await withinResearchDeadline(db.execute(sql`UPDATE competitor_snapshots SET status='unknown',error=${message},evidence=${JSON.stringify(evidence)}::jsonb
      WHERE id=${id} AND project_id=${projectId} AND page_id=${pageId}`), Date.now() + 3000); } catch { /* Durable unknown reservation remains. */ }
    return { status: 200, id, captureStatus: 'unknown', message };
  }
}
