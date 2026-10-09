import { XMLParser } from 'fast-xml-parser';
import { fetchPublicText } from './public-http';
import { stripHtml, truncate } from './connectors/util';
import type { Bounds, FetchResult, Raw } from './public-ingest-core';

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && '#text' in value)
    return String((value as Record<string, unknown>)['#text'] ?? '');
  return '';
}

export async function fetchNarrowRss(url: string, bounds: Bounds): Promise<FetchResult> {
  const response = await fetchPublicText(url, {
    allowedHostname: bounds.hostname, maxRedirects: bounds.maxRedirects,
    timeoutMs: bounds.timeoutMs, maxBytes: bounds.maxBytes,
    headers: { 'user-agent': 'RadarBot/1.0', accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml' },
  });
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(response.text);
  const raw = parsed?.rss?.channel?.item ?? parsed?.feed?.entry;
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (entries.length > 40) throw new Error('HOLD: RSS item bound');
  const feedTitle = text(parsed?.rss?.channel?.title) || text(parsed?.feed?.title) || bounds.hostname;
  const items: Raw[] = entries.map((entry: Record<string, unknown>) => {
    const title = stripHtml(text(entry.title));
    const link = text(entry.link) || text(entry.guid) || text(entry.id);
    const date = text(entry.pubDate) || text(entry.published) || text(entry.updated);
    const content = stripHtml(text(entry['content:encoded']) || text(entry.description)
      || text(entry.summary) || text(entry.content));
    if (!title || !link || !date) throw new Error('HOLD: RSS item incomplete');
    const article = new URL(link);
    if (article.protocol !== 'https:' || article.hostname !== bounds.hostname
        || article.username || article.password || article.port || article.hash)
      throw new Error('HOLD: RSS article URL');
    return { source: 'rss', externalId: link, title: truncate(title, 300),
      content: truncate(content || title, 1000), url: link, publishedAt: new Date(date),
      author: feedTitle, community: feedTitle };
  });
  return { items, hops: response.hops, status: 200, bytes: response.bytes };
}

type HnHit = { objectID?: string; title?: string; story_title?: string;
  comment_text?: string; author?: string; created_at?: string };
export async function fetchNarrowHn(term: string, bounds: Bounds): Promise<FetchResult> {
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(term)}`
    + '&tags=(story,comment)&hitsPerPage=50';
  const response = await fetchPublicText(url, {
    allowedHostname: bounds.hostname, maxRedirects: 0,
    timeoutMs: bounds.timeoutMs, maxBytes: bounds.maxBytes,
    headers: { accept: 'application/json' },
  });
  let data: { hits?: HnHit[] };
  try { data = JSON.parse(response.text); } catch { throw new Error('HOLD: HN JSON invalid'); }
  if (!Array.isArray(data.hits) || data.hits.length > 50) throw new Error('HOLD: HN item bound');
  const items: Raw[] = data.hits.map((hit) => {
    const id = hit.objectID;
    const title = stripHtml(hit.title || hit.story_title || '');
    const content = stripHtml(hit.comment_text || title);
    if (!id || !/^\d{1,20}$/.test(id) || !title || !hit.created_at)
      throw new Error('HOLD: HN item incomplete');
    return { source: 'hackernews', externalId: id, title: truncate(title, 300),
      content: truncate(content, 1200), url: `https://news.ycombinator.com/item?id=${id}`,
      publishedAt: new Date(hit.created_at), author: hit.author, community: 'Hacker News' };
  });
  return { items, hops: response.hops, status: 200, bytes: response.bytes };
}
