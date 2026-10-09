import 'server-only';
import { load } from 'cheerio/slim';
import { Parser } from 'htmlparser2';
import { sql } from 'drizzle-orm';
import { getDb, type DB } from '@/lib/db';
import { cleanStoredText } from './text-clean';
import { CAPTURE_INPUT_BYTES, selectedPublicUrl, type CompetitorPage } from './competitor-page';

export type SeoCheck = { id: string; label: string; status: 'pass' | 'fail' | 'unknown'; observed: string };
export type SeoEvidence = { status: 'observed' | 'unknown'; checks: SeoCheck[]; message: string };
export type SeoCapture = SeoEvidence & { pageId: number; snapshotId: number | null; sourceUrl: string; capturedAt: string | null };
const rules = [
  ['title', 'Single Nonempty Title'], ['description', 'Single Nonempty Meta Description'],
  ['headings', 'Nonempty H1 Present'], ['canonical', 'Single Public Canonical URL'],
  ['robots', 'Page Robots Index Directives'], ['image-alt', 'Image Alt Attributes'],
  ['json-ld', 'JSON-LD Presence And Syntax'], ['headers', 'HTTP Index Directives'],
] as const;
const unknown = (message: string): SeoEvidence => ({ status: 'unknown', message,
  checks: rules.map(([id, label]) => ({ id, label, status: 'unknown', observed: message })) });

function completeStaticDocument(html: string, deadline: number): boolean {
  const structural = new Set(['html', 'head', 'body']);
  const inert = new Set(['template', 'noscript', 'iframe', 'noembed', 'noframes', 'plaintext']);
  const ancestors: string[] = [], events: string[] = [];
  let invalid = false, elements = 0;
  const parser = new Parser({
    onopentag(name) {
      if (++elements > 5000 || Date.now() >= deadline) { invalid = true; parser.pause(); return; }
      if (structural.has(name) && !ancestors.some(ancestor => inert.has(ancestor))) {
        const parent = ancestors.at(-1);
        if (name === 'html' ? parent !== undefined : parent !== 'html') invalid = true;
        events.push(`open:${name}`);
      }
      ancestors.push(name);
    },
    onclosetag(name, isImplied) {
      if (isImplied && inert.has(name)) invalid = true;
      if (structural.has(name) && !ancestors.some(ancestor => inert.has(ancestor))) {
        if (isImplied) invalid = true;
        events.push(`close:${name}`);
      }
      ancestors.pop();
    },
  }, { xmlMode: false, lowerCaseTags: true });
  parser.end(html);
  return !invalid && events.join('|') === 'open:html|open:head|close:head|open:body|close:body|close:html';
}

export function inspectSeoHtml(html: string, sourceUrl: string, deadline = Date.now() + 500): SeoEvidence {
  if (Date.now() >= deadline || Buffer.byteLength(html) > CAPTURE_INPUT_BYTES) return unknown('Analysis budget exceeded; checks Unknown.');
  let base: string;
  try { base = selectedPublicUrl(sourceUrl); } catch { return unknown('Selected public URL unavailable; checks Unknown.'); }
  const cleaned = cleanStoredText(html);
  if (!completeStaticDocument(cleaned, deadline)) return unknown('Complete static HTML document unavailable; absence checks Unknown.');
  const $ = load(cleaned);
  if (Date.now() >= deadline || $('*').length > 5000) return unknown('Analysis time or 5,000-element limit exceeded; checks Unknown.');
  $('template,noscript').remove();
  const check = (id: typeof rules[number][0], status: SeoCheck['status'], observed: string): SeoCheck => ({
    id, label: rules.find(rule => rule[0] === id)![1], status, observed: cleanStoredText(observed, 320),
  });
  const text = (value: string) => cleanStoredText(value.replace(/\s+/g, ' ').trim(), 180);
  const head = $('head');
  const titles = head.find('title').toArray();
  const descriptions = head.find('meta').toArray().filter(node => ($(node).attr('name') ?? '').trim().toLowerCase() === 'description');
  const headings = $('body h1').toArray();
  const checks: SeoCheck[] = [
    check('title', titles.length === 1 && text($(titles[0]).text()) ? 'pass' : 'fail',
      `${titles.length} title element(s)${titles.length === 1 ? `; ${text($(titles[0]).text()) || 'empty'}` : ''}.`),
    check('description', descriptions.length === 1 && text($(descriptions[0]).attr('content') ?? '') ? 'pass' : 'fail',
      `${descriptions.length} description element(s)${descriptions.length === 1 ? `; ${text($(descriptions[0]).attr('content') ?? '') || 'empty'}` : ''}.`),
    check('headings', headings.some(node => text($(node).text())) ? 'pass' : 'fail',
      `${headings.length} H1 element(s); ${headings.filter(node => text($(node).text())).length} nonempty. No hierarchy or ranking judgment.`),
  ];
  const baseElements = head.find('base[href]').toArray();
  let validBase = baseElements.length <= 1;
  if (baseElements.length === 1) {
    try { base = selectedPublicUrl(new URL($(baseElements[0]).attr('href')!, base).href); } catch { validBase = false; }
  }
  const canonicals = head.find('link').toArray().filter(node => ($(node).attr('rel') ?? '').toLowerCase().split(/\s+/).includes('canonical'));
  let canonical: string | null = null;
  if (validBase && canonicals.length === 1) {
    try {
      const value = $(canonicals[0]).attr('href')?.trim();
      if (value) {
        const resolved = new URL(selectedPublicUrl(new URL(value, base).href));
        canonical = resolved.origin + resolved.pathname;
      }
    } catch { canonical = null; }
  }
  checks.push(check('canonical', !validBase ? 'unknown' : canonical ? 'pass' : 'fail', !validBase
    ? 'Base URL ambiguous or not public; canonical resolution Unknown.'
    : `${canonicals.length} canonical element(s)${canonical ? `; ${canonical}; query omitted` : '; missing, ambiguous or invalid'}. Not fetched or checked for equivalence.`));
  const directives = head.find('meta').toArray().filter(node => ['robots', 'googlebot', 'bingbot'].includes(($(node).attr('name') ?? '').trim().toLowerCase()))
    .flatMap(node => ($(node).attr('content') ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean));
  const restricted = directives.some(value => value === 'noindex' || value === 'none');
  const explicitIndex = directives.some(value => value === 'index' || value === 'all');
  checks.push(check('robots', restricted ? 'fail' : explicitIndex ? 'pass' : 'unknown', restricted
    ? 'A captured robots/googlebot/bingbot meta directive requests noindex; restrictive duplicates win.'
    : explicitIndex ? 'An explicit index/all meta directive is present; actual indexing and HTTP headers remain Unknown.'
      : 'No explicit index/noindex meta directive observed; indexing cannot be inferred.'));
  const images = $('body img').toArray();
  const missingAlt = images.filter(node => $(node).attr('alt') === undefined).length;
  const emptyAlt = images.filter(node => $(node).attr('alt') === '').length;
  checks.push(check('image-alt', !images.length ? 'unknown' : missingAlt ? 'fail' : 'pass',
    `${images.length} static image(s); ${missingAlt} missing alt attribute(s); ${emptyAlt} empty alt attribute(s). Empty alt may be decorative; meaning and browser images unverified.`));
  const scripts = $('script').toArray().filter(node => ($(node).attr('type') ?? '').trim().toLowerCase() === 'application/ld+json');
  let invalid = 0, limited = scripts.length > 50, jsonBytes = 0;
  if (!limited) for (const node of scripts) {
    const body = $(node).text();
    jsonBytes += Buffer.byteLength(body);
    if (jsonBytes > 256_000 || Date.now() >= deadline) { limited = true; break; }
    try {
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== 'object' || (Array.isArray(parsed) && (!parsed.length || parsed.some(item => !item || typeof item !== 'object' || Array.isArray(item))))) invalid++;
    } catch { invalid++; }
  }
  checks.push(check('json-ld', limited || !scripts.length ? 'unknown' : invalid ? 'fail' : 'pass', limited
    ? 'JSON-LD time, 50-script or 256KB limit reached; syntax Unknown.'
    : `${scripts.length} JSON-LD script(s); ${invalid} invalid/empty/object-shape failure(s). Presence and syntax only; vocabulary, accuracy, microdata and rich-result eligibility unverified.`));
  checks.push(check('headers', 'unknown', 'C1 does not retain X-Robots-Tag headers; no additional request is made.'));
  if (Date.now() >= deadline) return unknown('Analysis deadline reached; checks Unknown.');
  return { status: 'observed', checks, message: 'Deterministic saved static HTML observations, not a ranking, indexability or full-site audit.' };
}

export async function seoCaptureEvidence(projectId: number, pages: CompetitorPage[], db?: DB): Promise<SeoCapture[]> {
  const selected = pages.filter((page, index) => page.projectId === projectId && Number.isSafeInteger(page.id) && page.id > 0
    && pages.findIndex(candidate => candidate.id === page.id) === index)
    .sort((first, second) => Number(/\bhome\b/i.test(second.label)) - Number(/\bhome\b/i.test(first.label))).slice(0, 5);
  if (!selected.length) return [];
  const rows = (await (db ?? await getDb()).execute(sql`SELECT DISTINCT ON(snapshot.page_id)
    snapshot.id,snapshot.page_id,snapshot.source_url,snapshot.captured_at,snapshot.status,snapshot.raw_html,page.url AS current_url
    FROM competitor_snapshots snapshot JOIN competitor_pages page ON page.id=snapshot.page_id AND page.project_id=snapshot.project_id
    WHERE snapshot.project_id=${projectId} AND page.project_id=${projectId}
    AND snapshot.page_id IN (${sql.join(selected.map(page => sql`${page.id}`), sql`,`)})
    ORDER BY snapshot.page_id,snapshot.captured_at DESC,snapshot.id DESC`)).rows;
  return selected.map(page => {
    const row = rows.find(candidate => Number(candidate.page_id) === page.id);
    const valid = row?.status === 'ok' && row.current_url === page.url && row.source_url === page.url && typeof row.raw_html === 'string';
    return { pageId: page.id, snapshotId: row ? Number(row.id) : null, sourceUrl: page.url,
      capturedAt: row ? new Date(row.captured_at as string).toISOString() : null,
      ...(valid ? inspectSeoHtml(row.raw_html as string, page.url) : unknown('Latest current-page capture unavailable or unsuccessful; no older success substituted.')) };
  });
}
