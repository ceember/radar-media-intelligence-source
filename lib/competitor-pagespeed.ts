import { sql } from 'drizzle-orm';
import { getDb, type DB } from '@/lib/db';
import { fetchPublicText, fetchPublicAuditGateway, validatePublicUrl } from '@/lib/public-http';
import { withinResearchDeadline } from '@/lib/web-research';
import { selectedCompetitorPages } from '@/lib/competitor-snapshots';
import { selectedPublicUrl } from '@/lib/competitor-page';
import { cleanStoredText } from '@/lib/text-clean';
import { toolsGateway } from './mi-tools-gateway';

export const PAGESPEED_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
export type PageSpeedStrategy = 'mobile' | 'desktop';
export type PageSpeedProvider = 'google' | 'f9';
export type PageSpeedResult = {
  requestedUrl: string; finalUrl: string | null; measuredAt: string; version: string;
  scores: Record<typeof PAGESPEED_CATEGORIES[number], number | null>;
  lcpMs: number | null; cls: number | null; tbtMs: number | null;
  diagnostics: { id: string; title: string; display: string | null; score: number | null }[];
  warnings: string[];
};
export type PageSpeedAudit = { id: number; pageId: number; sourceUrl: string; strategy: PageSpeedStrategy;
  provider: PageSpeedProvider; checkedAt: string; status: string; message: string | null; result: PageSpeedResult | null };
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const score = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 100) : null;
const text = (v: unknown, limit = 200) => typeof v === 'string' ? cleanStoredText(v, limit) : '';

/** Compact lab observations only; never store the provider report, screenshots or field data. */
export function parsePageSpeed(value: unknown, requestedUrl: string, strategy: PageSpeedStrategy): PageSpeedResult {
  const data = object(value), report = object(data.lighthouseResult), settings = object(report.configSettings);
  const form = settings.formFactor ?? settings.emulatedFormFactor;
  if (Object.keys(object(report.runtimeError)).length || ['CAPTCHA_BLOCKING', 'CAPTCHA_NEEDED', 'CAPTCHA_UNMATCHED'].includes(String(data.captchaResult)) ||
    (form !== undefined && form !== strategy)) throw new Error('PageSpeed did not complete a usable lab audit.');
  if (typeof report.requestedUrl !== 'string' || selectedPublicUrl(report.requestedUrl) !== requestedUrl || typeof report.finalUrl !== 'string')
    throw new Error('PageSpeed returned a mismatched lab report; no measurements saved.');
  const finalUrl = selectedPublicUrl(report.finalUrl), measured = text(report.fetchTime, 64);
  if (!/^\d{4}-\d\d-\d\dT/.test(measured) || !Number.isFinite(Date.parse(measured))) throw new Error('PageSpeed returned no valid lab measurement date.');
  const categories = object(report.categories), audits = object(report.audits);
  const scores = Object.fromEntries(PAGESPEED_CATEGORIES.map(id => [id, score(object(categories[id]).score)])) as PageSpeedResult['scores'];
  const metric = (id: string, unit: string, max: number) => {
    const audit = object(audits[id]), number = audit.numericValue;
    return audit.scoreDisplayMode !== 'error' && (audit.numericUnit === undefined || audit.numericUnit === unit) &&
      typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= max ? number : null;
  };
  const lcpMs = metric('largest-contentful-paint', 'millisecond', 86_400_000), cls = metric('cumulative-layout-shift', 'unitless', 1000),
    tbtMs = metric('total-blocking-time', 'millisecond', 86_400_000);
  if (Object.values(scores).every(s => s === null) && lcpMs === null && cls === null && tbtMs === null)
    throw new Error('PageSpeed returned no usable lab measurements.');
  return { requestedUrl, finalUrl, measuredAt: new Date(measured).toISOString(), version: text(report.lighthouseVersion, 40), scores, lcpMs, cls, tbtMs,
    diagnostics: ['render-blocking-resources', 'unused-javascript', 'unused-css-rules', 'server-response-time', 'bootup-time', 'dom-size'].flatMap(id => {
      const audit = object(audits[id]);
      return typeof audit.title === 'string' ? [{ id, title: text(audit.title), display: text(audit.displayValue, 120) || null, score: score(audit.score) }] : [];
    }), warnings: Array.isArray(report.runWarnings) ? report.runWarnings.filter(v => typeof v === 'string').slice(0, 5).map(v => text(v)) : [] };
}
export function pageSpeedEndpoint(url: string, strategy: PageSpeedStrategy, key = process.env.PAGESPEED_API_KEY) {
  const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  endpoint.searchParams.set('url', selectedPublicUrl(url)); endpoint.searchParams.set('strategy', strategy); endpoint.searchParams.set('locale', 'en');
  for (const category of PAGESPEED_CATEGORIES) endpoint.searchParams.append('category', category);
  if (key?.trim()) endpoint.searchParams.set('key', key.trim());
  return endpoint.href;
}
export function pageSpeedGateway() {
  return process.env.MI_TOOLS_AUDIT_ENABLED === '1' ? toolsGateway('audit-page') : null;
}
/** Gateway contract: scores are already 0–100, metrics use milliseconds and unitless CLS. */
export function parseGatewayAudit(value: unknown, requestedUrl: string, recordedAt = new Date().toISOString()): PageSpeedResult {
  const data = object(value), scores = object(data.scores);
  const metric = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
  const normalized = Object.fromEntries(PAGESPEED_CATEGORIES.map(id => [id, metric(scores[id], 100)])) as PageSpeedResult['scores'];
  const lcpMs = metric(data.lcp_ms, 86_400_000), cls = metric(data.cls, 1000), tbtMs = metric(data.tbt_ms, 86_400_000);
  if (data.error || Object.values(normalized).some(v => v === null) || lcpMs === null || cls === null || tbtMs === null || !Number.isFinite(Date.parse(recordedAt)))
    throw Error('PageSpeed own-server gateway returned incomplete lab measurements.');
  return { requestedUrl: selectedPublicUrl(requestedUrl), finalUrl: null, measuredAt: new Date(recordedAt).toISOString(), version: '',
    scores: normalized, lcpMs, cls, tbtMs, diagnostics: [], warnings: ['Gateway response recorded at the shown time. Audit timestamp, final URL and runner version are not supplied.'] };
}
export async function pageSpeedHistory(projectId: number, db?: DB): Promise<PageSpeedAudit[]> {
  const rows = (await (db ?? await getDb()).execute(sql`SELECT DISTINCT ON(page_id,strategy,provider)
    id,page_id AS "pageId",source_url AS "sourceUrl",strategy,provider,checked_at AS "checkedAt",status,message,result
    FROM competitor_pagespeed_audits WHERE project_id=${projectId} ORDER BY page_id,strategy,provider,checked_at DESC,id DESC`)).rows;
  return rows.map(r => ({ ...r, checkedAt: new Date(r.checkedAt as string).toISOString() })) as PageSpeedAudit[];
}
export async function auditCompetitorPage(projectId: number, pageId: number, strategy: PageSpeedStrategy, deadline?: number, provider: PageSpeedProvider = 'google') {
  deadline ??= Date.now() + (provider === 'f9' ? 110_000 : 20_000);
  const wait = <T>(p: PromiseLike<T>) => withinResearchDeadline(p, deadline);
  if (!['mobile', 'desktop'].includes(strategy)) return { status: 400, error: 'Choose mobile or desktop.' };
  if (!['google', 'f9'].includes(provider)) return { status: 400, error: 'Choose an available lab provider.' };
  const gateway = provider === 'f9' ? pageSpeedGateway() : null;
  if (provider === 'f9' && !gateway) return { status: 503, error: 'Own-server lab audit is not configured.' };
  const db = await wait(getDb()), page = (await wait(selectedCompetitorPages(projectId, db))).find(p => p.id === pageId);
  if (!page) return { status: 404, error: 'Selected page not found in this project.' };
  const url = selectedPublicUrl(page.url);
  const cached = (await wait(db.execute(sql`SELECT id FROM competitor_pagespeed_audits WHERE project_id=${projectId}
    AND page_id=${pageId} AND source_url=${url} AND strategy=${strategy} AND provider=${provider} AND status='ok' AND checked_at>now()-interval '24 hours'
    ORDER BY checked_at DESC,id DESC LIMIT 1`))).rows[0];
  if (cached) return { status: 200, id: cached.id, cached: true, message: 'Successful lab audit cached for 24 hours; no provider call or new attempt.' };
  // Validate the selected public DNS target before quota or provider use; Google does the actual audit.
  await wait(validatePublicUrl(url));
  if (gateway) await wait(validatePublicUrl(gateway.endpoint));
  const reservation = await wait(db.execute(sql`WITH slot AS (
    INSERT INTO competitor_pagespeed_usage(project_id,utc_day,attempts) VALUES(${projectId},(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,1)
    ON CONFLICT(project_id,utc_day) DO UPDATE SET attempts=competitor_pagespeed_usage.attempts+1
    WHERE competitor_pagespeed_usage.attempts<10 RETURNING attempts)
    INSERT INTO competitor_pagespeed_audits(project_id,page_id,entity_id,source_url,strategy,provider)
    SELECT ${projectId},p.id,p.entity_id,p.url,${strategy},${provider} FROM slot JOIN competitor_pages p ON p.id=${pageId} AND p.project_id=${projectId} RETURNING id`));
  const id = reservation.rows[0]?.id;
  if (!id) return { status: 429, error: 'Ten PageSpeed attempts used today. Resets at midnight UTC; failed attempts count.' };
  try {
    const response = gateway ? await wait(fetchPublicAuditGateway(gateway.endpoint, { allowedHostname: gateway.hostname,
      maxBytes: 2_000_000, timeoutMs: Math.min(100_000, Math.max(1, deadline - Date.now() - 3000)),
      body: JSON.stringify({ url, strategy }), headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${gateway.token}` } })) :
      await wait(fetchPublicText(pageSpeedEndpoint(url, strategy), { allowedHostname: 'www.googleapis.com', maxRedirects: 0,
        maxBytes: 2_000_000, maxUrlBytes: 8000, timeoutMs: Math.min(18_000, Math.max(1, deadline - Date.now())), headers: { Accept: 'application/json' } }));
    if (!/^application\/json\b/i.test(response.contentType) || Buffer.byteLength(response.text) > 2_000_000) throw new Error('PageSpeed returned no usable lab measurements.');
    const result = gateway ? parseGatewayAudit(JSON.parse(response.text), url) : parsePageSpeed(JSON.parse(response.text), url, strategy);
    const savedMessage = gateway ? 'Lab audit, own server' : 'Hosted Lighthouse lab audit saved.';
    const saved = await wait(db.execute(sql`UPDATE competitor_pagespeed_audits SET status='ok',result=${JSON.stringify(result)}::jsonb,
      checked_at=now(),message=${savedMessage} WHERE id=${id} AND project_id=${projectId} AND page_id=${pageId}
      AND clock_timestamp()<${new Date(deadline).toISOString()}::timestamptz RETURNING id`));
    if (!saved.rows.length) throw new Error('PageSpeed exceeded its audit deadline; no lab measurements saved.');
    return { status: 200, id, cached: false, message: gateway ? 'Lab audit, own server saved. Scores describe this lab test, not all visitors.' : 'Hosted lab audit saved. Scores describe this dated test, not all visitors.' };
  } catch (error) {
    const message = error instanceof Error && error.message === 'Public HTTP status 429'
      ? gateway ? 'Own-server lab capacity is rate limited. No automatic retry; try again later.' : 'PageSpeed capacity is rate limited. No automatic retry; try again on a later day.'
      : error instanceof Error && error.message.startsWith('PageSpeed ') ? error.message
      : gateway ? 'Own-server lab audit was unavailable or exceeded its 100-second transport budget. No lab measurements saved; no automatic retry.' : 'PageSpeed was unavailable or exceeded its 20-second request budget. No lab measurements saved; no automatic retry.';
    try { await withinResearchDeadline(db.execute(sql`UPDATE competitor_pagespeed_audits SET status='unknown',result=NULL,message=${message}
      WHERE id=${id} AND project_id=${projectId} AND page_id=${pageId}`), Date.now() + 3000); } catch { /* Durable unknown reservation survives. */ }
    return { status: 200, id, cached: false, auditStatus: 'unknown', message };
  }
}
