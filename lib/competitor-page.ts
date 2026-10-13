import { createHash } from 'node:crypto';
import { diffLines } from 'diff';
import { load } from 'cheerio/slim';
import { cleanStoredText } from './text-clean';
import type { StructuredOffers } from './competitor-offers';

export const CAPTURE_DAILY_CAP = 30;
export const SELECTED_PAGE_CAP = 10;
export const CAPTURE_INPUT_BYTES = 2_000_000;
export type CrawlEvidence = {
  status: 'allowed' | 'disallowed' | 'unknown'; origin: string; userAgent: string;
  checkedAt: string; rule: string | null; delay: number; sitemaps: string[]; reason: string;
  httpStatus?: number | null; accessCase?: 'rules' | 'unavailable' | 'unreachable';
};
export type CaptureEvidence = { robots: CrawlEvidence; inputBytes?: number; finalUrl?: string;
  textBytes?: number; textLimitBytes?: number; truncated?: boolean; method?: string };
export type CompetitorPage = { id: number; projectId: number; entityId: number; entity: string; label: string; url: string };
export type CompetitorSnapshot = { id: number; pageId: number; sourceUrl: string; capturedAt: string;
  status: string; text: string | null; hash: string | null; error: string | null; evidence: CaptureEvidence | null; offers?: StructuredOffers | null };

export function selectedPublicUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1800 || /[\x00-\x20\x7f]/.test(value)) throw new Error('Enter a public HTTPS page URL (up to 1800 characters).');
  if (/^https:\/\/[^/?#]+:\d+/i.test(value)) throw new Error('Use the default HTTPS port without an explicit port.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
    !url.hostname.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname) ||
    /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) throw new Error('Use a public HTTPS hostname without credentials, a port or fragment.');
  return url.href;
}
export function utf8Bound(value: string, bytes = 20_000): string {
  let result = '', used = 0;
  for (const char of cleanStoredText(value)) {
    const size = Buffer.byteLength(char);
    if (used + size > bytes) break;
    result += char; used += size;
  }
  return result;
}
export function competitorTextLimit(page: Pick<CompetitorPage, 'label' | 'url'>) {
  return /\b(packages?|deals?|plans?|pricing|fibre|fiber)\b/i.test(page.label) ||
    /\/(fibre[^/]*|fiber[^/]*|deals?|packages?|plans?|pricing|5Ghomewifi)(\/|$)/i.test(new URL(page.url).pathname) ? 60_000 : 20_000;
}
export function normalizeCompetitorHtml(html: string, textLimitBytes = 20_000) {
  if (![20_000, 60_000].includes(textLimitBytes)) throw new Error('Unsupported competitor text limit.');
  const $ = load(cleanStoredText(html));
  $('script,style,noscript,svg,nav,header,footer,form,iframe,template,head,[hidden],[aria-hidden="true"]').remove();
  // ponytail: reuse Radar's static parser; browser rendering remains an explicit unknown.
  const main = $('main').first(), body = $('body').first();
  const root = main.length ? main : body.length ? body : $('<div>').append($.root().contents());
  root.find('br').replaceWith('\n');
  root.find('p,div,h1,h2,h3,h4,h5,h6,li,tr,section,article').after('\n');
  const decoded = root.text().split(/\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  const text = utf8Bound(decoded, textLimitBytes);
  return { text, hash: createHash('sha256').update(text).digest('hex'), textBytes: Buffer.byteLength(text),
    textLimitBytes, truncated: Buffer.byteLength(decoded) > textLimitBytes, method: 'Cheerio static HTML block text v1 (navigation and scripts removed)' };
}
export function normalizeCompetitorRenderedText(body:string,textLimitBytes=20_000){
  if(![20_000,60_000].includes(textLimitBytes))throw Error('Unsupported competitor text limit.');
  const decoded=cleanStoredText(body).split(/\r?\n/).map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
  const text=utf8Bound(decoded,textLimitBytes);
  return {text,hash:createHash('sha256').update(text).digest('hex'),textBytes:Buffer.byteLength(text),textLimitBytes,
    truncated:Buffer.byteLength(decoded)>textLimitBytes||body.length===100_000,method:'Own server rendered BODY text (not HTML; DOM, technology, SEO and structured offers unobserved)'};
}
export function competitorDiff(previous: CompetitorSnapshot | undefined, current: CompetitorSnapshot) {
  if (current.status !== 'ok' || current.text === null) return { status: 'unknown' as const, changes: [] };
  if (!previous || previous.status !== 'ok' || previous.text === null || previous.sourceUrl !== current.sourceUrl)
    return { status: 'baseline' as const, changes: [] };
  if((current.evidence?.method?.startsWith('Own server rendered')||previous.evidence?.method?.startsWith('Own server rendered'))&&current.evidence?.method!==previous.evidence?.method)
    return {status:'unknown' as const,changes:[]};
  if (previous.evidence?.truncated || current.evidence?.truncated) return { status: 'partial' as const, changes: [] };
  const changes = diffLines(previous.text, current.text, { timeout: 1000, maxEditLength: 500 });
  if (!changes) return { status: 'limited' as const, changes: [] };
  return { status: previous.hash === current.hash ? 'unchanged' as const : 'changed' as const,
    changes: changes.filter((change) => change.added || change.removed).slice(0, 100),
    omitted: changes.filter((change) => change.added || change.removed).length > 100 };
}
