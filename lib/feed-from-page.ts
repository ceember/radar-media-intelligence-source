import { createHash } from 'node:crypto';
import { load } from 'cheerio/slim';
import robotsParser from 'robots-parser';
import { fetchPublicText } from './public-http';
import { researchPublicUrl } from './tavily-research';
import { cleanStoredText } from './text-clean';

export type FeedSelectors = { item: string; link: string; title: string; summary: string };
export type PageFeedItem = { url: string; urlHash: string; title: string; summary: string };
export const FEED_PARSER = 'css-selector-pattern@16dc6b38+cheerio@1.2.0';

export function publisherUrl(raw: unknown): string | null {
  const url = researchPublicUrl(raw);
  if (!url || !url.startsWith('https://')) return null;
  const host = new URL(url).hostname;
  if (new URL(url).port || Buffer.byteLength(url) > 2000) return null;
  return /(^|\.)(facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|tiktok\.com|reddit\.com|youtube\.com)$/i.test(host) ? null : url;
}
export function feedSelectors(raw: unknown): FeedSelectors | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  for (const field of ['item','link','title','summary']) {
    if (typeof value[field] !== 'string' || !value[field].trim()
      || !/^[A-Za-z0-9_.#> -]{1,120}$/.test(value[field])) return null;
  }
  const selectors = { item: (value.item as string).trim(), link: (value.link as string).trim(),
    title: (value.title as string).trim(), summary: (value.summary as string).trim() };
  for (const selector of Object.values(selectors)) {
    if (selector.split(/\s*>\s*|\s+/).some(part => !part || !/^(?:[A-Za-z][A-Za-z0-9_-]*)?(?:[.#][A-Za-z_][A-Za-z0-9_-]*)*$/.test(part))) return null;
  }
  try {
    const $ = load('<article><a>Title</a><p>Summary</p></article>');
    for (const selector of Object.values(selectors)) $(selector);
  } catch { return null; }
  return selectors;
}

export function parsePublisherPage(html: string, url: string, selectors: FeedSelectors): PageFeedItem[] {
  if (publisherUrl(url) !== url || Buffer.byteLength(html) > 2_000_000 || !feedSelectors(selectors)) throw new Error('Source or selectors exceed the supported bounds.');
  const $ = load(html), source = new URL(url);
  $('script,style,iframe,svg,noscript,form,template,[hidden]').remove();
  const items = new Map<string, PageFeedItem>();
  try {
    $(selectors.item).slice(0,50).each((_index, node) => {
      const item = $(node), raw = item.find(selectors.link).first().attr('href');
      if (!raw || /[\u0000-\u0020\u007f]/.test(raw)) return;
      let link: URL;
      try { link = new URL(raw, source); } catch { return; }
      if (link.origin !== source.origin || link.username || link.password) return;
      link.hash = '';
      const title = cleanStoredText(item.find(selectors.title).first().text().replace(/\s+/g,' ').trim(), 300);
      const summary = cleanStoredText(item.find(selectors.summary).first().text().replace(/\s+/g,' ').trim(), 1000);
      if (!title || link.href.length > 2000) return;
      items.set(link.href, { url: link.href, urlHash: createHash('sha256').update(link.href).digest('hex'), title, summary });
    });
  } catch { throw new Error('Selectors are invalid. Use tags, .classes, #ids and child/descendant selectors.'); }
  if (!items.size) throw new Error('No usable items matched. Check the item, title and link selectors against the static page.');
  return [...items.values()];
}

export function publisherRobotsAllowed(url: string, body: string): boolean {
  if (Buffer.byteLength(body) > 50_000 || /<\s*(?:!doctype|html|body)\b/i.test(body)
    || !/^\s*user-agent\s*:\s*\S+/im.test(body)) return false;
  const lines = body.split(/\r?\n/);
  if (lines.some(line => /^(user-agent|allow|disallow|crawl-delay)\b/i.test(line.trim()) && !/^\s*(user-agent|allow|disallow|crawl-delay)\s*:/i.test(line))) return false;
  if (lines.some(line => {
    const field = line.split('#',1)[0].match(/^\s*(user-agent|allow|disallow|crawl-delay)\s*:\s*(.*?)\s*$/i);
    if (!field) return false;
    if (field[1].toLowerCase() === 'user-agent') return !field[2];
    if (field[1].toLowerCase() === 'crawl-delay') return !/^\d+(?:\.\d+)?$/.test(field[2]) || !Number.isFinite(Number(field[2]));
    return field[2] !== '' && !/^[/*]/.test(field[2]);
  })) return false;
  try {
    const policy = robotsParser(`${new URL(url).origin}/robots.txt`, body), delay = policy.getCrawlDelay('RadarBot/1.0');
    return policy.isAllowed(url,'RadarBot/1.0') === true && (delay === undefined || Number.isFinite(delay) && delay <= 3600);
  } catch { return false; }
}

export function publisherHasAccessBarrier(html: string): boolean {
  if (Buffer.byteLength(html) > 2_000_000) throw new Error('Source or selectors exceed the supported bounds.');
  const $ = load(html);
  let blocked = false;
  $('input').each((_index,node) => {
    if (($(node).attr('type') ?? '').trim().toLowerCase() === 'password') blocked = true;
  });
  $('[id],[class],[data-paywall],[data-captcha]').each((_index,node) => {
    const element = $(node);
    if (/paywall|captcha/i.test(`${element.attr('id') ?? ''} ${element.attr('class') ?? ''}`)
      || element.attr('data-paywall') !== undefined || element.attr('data-captcha') !== undefined) blocked = true;
  });
  $('form').each((_index,node) => {
    const form = $(node);
    let action = form.attr('action') ?? '';
    try { action = decodeURIComponent(action); } catch { blocked = true; }
    if (/(?:^|[\s/_?&#=-])(?:log[\s_-]?in|sign[\s_-]?in|authenticate)(?:$|[\s/_?&#=-])/i.test(
      `${form.attr('id') ?? ''} ${form.attr('class') ?? ''} ${action}`)) blocked = true;
    form.find('input[autocomplete]').each((_fieldIndex,field) => {
      if (/(?:^|\s)(?:username|current-password|new-password)(?:$|\s)/i.test($(field).attr('autocomplete') ?? '')) blocked = true;
    });
  });
  const text = $.root().text().replace(/\s+/g,' ');
  return blocked || /"isAccessibleForFree"\s*:\s*false/i.test(html)
    || /subscribe to (?:read|continue)|sign in to (?:read|continue)/i.test(text);
}

export async function fetchPublisherItems(url: string, selectors: FeedSelectors, fetchPage = fetchPublicText): Promise<PageFeedItem[]> {
  if (publisherUrl(url) !== url) throw new Error('Use a public HTTPS static publisher page.');
  const source = new URL(url), headers = { 'user-agent':'RadarBot/1.0', 'Accept-Encoding':'identity' };
  let robots;
  try { robots = await fetchPage(`${source.origin}/robots.txt`, { headers, allowedHostname:source.hostname, maxRedirects:0, maxBytes:50_000, timeoutMs:5000 }); }
  catch { throw new Error('Robots policy is unavailable. No publisher page was fetched.'); }
  if (!publisherRobotsAllowed(url,robots.text)) throw new Error('Robots policy does not clearly allow this page at the supported hourly interval.');
  const page = await fetchPage(url, { headers, allowedHostname:source.hostname, maxRedirects:0, maxBytes:2_000_000, timeoutMs:12_000 });
  if (!page.contentType.toLowerCase().includes('html')) throw new Error('The source is not a static HTML publisher page.');
  if (publisherHasAccessBarrier(page.text)) throw new Error('The source has an access barrier. Use an approved public static page.');
  return parsePublisherPage(page.text, page.finalUrl, selectors);
}

const SAFE_FEED_ERRORS = new Set([
  'Source or selectors exceed the supported bounds.',
  'Selectors are invalid. Use tags, .classes, #ids and child/descendant selectors.',
  'No usable items matched. Check the item, title and link selectors against the static page.',
  'Use a public HTTPS static publisher page.',
  'Robots policy is unavailable. No publisher page was fetched.',
  'Robots policy does not clearly allow this page at the supported hourly interval.',
  'The source is not a static HTML publisher page.',
  'The source has an access barrier. Use an approved public static page.',
]);

export function pageFeedFailure(error: unknown): string {
  return error instanceof Error && SAFE_FEED_ERRORS.has(error.message)
    ? error.message : 'Publisher reading failed or timed out. Check the public source and selectors.';
}
