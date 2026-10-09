import 'server-only';
import { load } from 'cheerio/slim';
import { sql } from 'drizzle-orm';
import { getDb, type DB } from '@/lib/db';
import { cleanStoredText } from './text-clean';
import { selectedPublicUrl, CAPTURE_INPUT_BYTES, type CompetitorPage } from './competitor-page';

// Modified 2026-10-08: 28 narrowed structural fingerprints from enthec/webappanalyzer
// eea872af449e207e055398f7369d11ee48c8ea03, GPL-3.0. See technology-fingerprints/upstream.json.
// No upstream regex, runtime, JavaScript execution, headers or endpoint probes.
export type TechnologyMarker = { kind: 'Generator' | 'Script URL' | 'Stylesheet URL' | 'HTML Marker'; value: string; confidence: 'High' | 'Medium'; version?: string };
export type TechnologyTag = { technology: string; markers: TechnologyMarker[] };
export type TechnologyEvidence = { status: 'observed' | 'partial' | 'unknown'; tags: TechnologyTag[]; message: string };
export type TechnologyCapture = TechnologyEvidence & { pageId: number; snapshotId: number | null; sourceUrl: string; capturedAt: string | null };
export const TECHNOLOGY_RULESET = 'Radar Static Fingerprints v1 · 28 rules / 18 technologies';

export function detectTechnologies(html: string, sourceUrl: string, deadline = Date.now() + 500): TechnologyEvidence {
  const unknown = (message: string): TechnologyEvidence => ({ status: 'unknown', tags: [], message });
  if (Date.now() >= deadline || Buffer.byteLength(html) > CAPTURE_INPUT_BYTES) return unknown('Capture exceeds the technology analysis budget; stack Unknown.');
  let base: string;
  try { base = selectedPublicUrl(sourceUrl); } catch { return unknown('No valid captured public page; stack Unknown.'); }
  const $ = load(cleanStoredText(html)), tags: TechnologyTag[] = [];
  if (Date.now() >= deadline) return unknown('Capture exceeds the technology analysis budget; stack Unknown.');
  const add = (technology: string, marker: TechnologyMarker) => {
    let tag = tags.find(t => t.technology === technology);
    if (!tag) { tag = { technology, markers: [] }; tags.push(tag); }
    if (tag.markers.length < 3 && !tag.markers.some(m => m.kind === marker.kind && m.value === marker.value)) tag.markers.push(marker);
  };
  const generators = [['WordPress', 'WordPress'], ['Drupal', 'Drupal'], ['Joomla', 'Joomla!'], ['Ghost', 'Ghost'],
    ['Wix', 'Wix.com Website Builder'], ['Webflow', 'Webflow'], ['Matomo Analytics', 'Matomo - Open Source Web Analytics']] as const;
  const nodes = $('meta[name="generator"],script[src],link[rel="stylesheet"],[data-reactroot],[data-reactid],div#__nuxt').toArray();
  let partial = false;
  for (let index = 0; index < nodes.length; index++) {
    if (index >= 1000 || Date.now() >= deadline) { partial = true; break; }
    const node = $(nodes[index]);
    if (node.is('meta')) {
      const value = cleanStoredText(node.attr('content') ?? '', 150).trim();
      for (const [technology, prefix] of generators) {
        if (value === prefix || value.startsWith(prefix + ' ')) {
          const version = value.slice(prefix.length).match(/^\s+(\d{1,4}(?:\.\d{1,4}){0,3})(?:\s|$)/)?.[1];
          add(technology, { kind: 'Generator', value, confidence: 'High', ...(version ? { version } : {}) });
        }
      }
    } else if (node.is('script,link')) {
      const raw = node.attr(node.is('script') ? 'src' : 'href');
      if (!raw || raw.length > 2000 || /[\x00-\x20\x7f]/.test(raw)) continue;
      let url: URL;
      try { url = new URL(raw, base); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      // Public script URLs sometimes carry tokens; query/fragment values never become displayed evidence.
      const value = cleanStoredText(url.origin + url.pathname, 512), kind = node.is('script') ? 'Script URL' : 'Stylesheet URL';
      const path = url.pathname, file = path.split('/').pop() ?? '', host = url.hostname;
      const asset = (name: string, confidence: TechnologyMarker['confidence'] = 'Medium', version?: string) => add(name, { kind, value, confidence, ...(version ? { version } : {}) });
      if (/\/wp-(?:content|includes)\//.test(path)) asset('WordPress');
      const bootstrap = file.match(/^bootstrap(?:[.-](\d{1,3}(?:\.\d{1,3}){1,3}))?(?:\.bundle)?(?:\.min)?\.(?:js|css)$/i);
      if (bootstrap) asset('Bootstrap', 'Medium', bootstrap[1]);
      if (!node.is('script')) continue;
      if (file === 'drupal.js') asset('Drupal');
      if (/\/(?:feed|components)\/com_/.test(path)) asset('Joomla');
      if (['cdn.shopify.com', 'sdks.shopifycdn.com'].includes(host)) asset('Shopify', 'High');
      if (path.startsWith('/_nuxt/')) asset('Nuxt.js');
      for (const [technology, pattern] of [
        ['React', /^react(?:-with-addons)?(?:[.-](\d{1,3}(?:\.\d{1,3}){1,3}))?(?:\.production)?(?:\.min)?\.js$/i],
        ['jQuery', /^jquery(?:[.-](\d{1,3}(?:\.\d{1,3}){1,3}))?(?:\.min)?\.js$/i],
        ['Vue.js', /^vue(?:[.-](\d{1,3}(?:\.\d{1,3}){1,3}))?(?:\.min)?\.js$/i],
      ] as const) { const match = file.match(pattern); if (match) asset(technology, 'Medium', match[1]); }
      if ((host === 'google-analytics.com' || host.endsWith('.google-analytics.com')) && ['/ga.js', '/urchin.js', '/analytics.js'].includes(path)) asset('Google Analytics', 'High');
      if (host === 'www.googletagmanager.com' || host === 'googletagmanager.com') {
        if (path === '/gtag/js') asset('Google Analytics', 'High');
        if (path === '/gtm.js') asset('Google Tag Manager', 'High');
      }
      if (host === 'static.hotjar.com') asset('Hotjar', 'High');
      if (host.endsWith('.hs-scripts.com')) asset('HubSpot', 'High');
      if (file === 'piwik.js' || file === 'piwik.php') asset('Matomo Analytics');
      if ((host === 's3.amazonaws.com' && path === '/downloads.mailchimp.com/js/mc-validate.js') || (host === 'chimpstatic.com' && path.startsWith('/mcjs-connected'))) asset('MailChimp', 'High');
      if (host === 'static.parastorage.com') asset('Wix', 'High');
    } else {
      if (node.is('[data-reactroot],[data-reactid]')) add('React', { kind: 'HTML Marker', value: node.is('[data-reactroot]') ? 'data-reactroot attribute' : 'data-reactid attribute', confidence: 'Medium' });
      if (node.is('div#__nuxt')) add('Nuxt.js', { kind: 'HTML Marker', value: 'div id="__nuxt"', confidence: 'Medium' });
    }
  }
  return { status: partial ? 'partial' : tags.length ? 'observed' : 'unknown', tags,
    message: partial ? 'Analysis stopped at its time or 1,000-marker limit; remaining technology Unknown.' : tags.length ? 'Markers observed in saved static HTML; use and the full stack are not verified.' : 'No curated marker observed in this capture; stack Unknown.' };
}

/** Read existing immutable evidence only, at most five latest captures, always project scoped. */
export async function technologyCaptureEvidence(projectId: number, pages: CompetitorPage[], db?: DB): Promise<TechnologyCapture[]> {
  const scoped = pages.filter((page,index) => page.projectId === projectId && Number.isSafeInteger(page.id) && page.id > 0
    && pages.findIndex(candidate => candidate.id === page.id) === index);
  const chosen = scoped.sort((first, second) => Number(/\bhome\b/i.test(second.label)) - Number(/\bhome\b/i.test(first.label))).slice(0, 5);
  if (!chosen.length) return [];
  const rows = (await (db ?? await getDb()).execute(sql`SELECT DISTINCT ON(snapshot.page_id)
    snapshot.id,snapshot.page_id,snapshot.source_url,snapshot.captured_at,snapshot.status,snapshot.raw_html,page.url AS current_url
    FROM competitor_snapshots snapshot JOIN competitor_pages page ON page.id=snapshot.page_id AND page.project_id=snapshot.project_id
    WHERE snapshot.project_id=${projectId} AND page.project_id=${projectId}
      AND page.id IN (${sql.join(chosen.map(page => sql`${page.id}`), sql`,`)})
    ORDER BY snapshot.page_id,snapshot.captured_at DESC,snapshot.id DESC`)).rows;
  return chosen.map(page => {
    const row = rows.find(candidate => Number(candidate.page_id) === page.id);
    const valid = row?.status === 'ok' && row.current_url === page.url && row.source_url === page.url && typeof row.raw_html === 'string';
    return { pageId: page.id, snapshotId: row ? Number(row.id) : null, sourceUrl: page.url, capturedAt: row ? new Date(row.captured_at as string).toISOString() : null,
      ...(valid ? detectTechnologies(row.raw_html as string, page.url) : { status: 'unknown' as const, tags: [], message: 'No successful current static HTML capture; stack Unknown.' }) };
  });
}
