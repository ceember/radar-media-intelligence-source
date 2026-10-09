import { createHash } from 'node:crypto';
import { Feed } from 'feed';
import type { PageFeedItem } from './feed-from-page';

export type FeedFormat = 'rss' | 'atom' | 'json';
export type ObservedFeedItem = PageFeedItem & { observedAt: Date; updatedAt: Date };
const escapeHtml = (value: string) => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

export function serializePageFeed(source: { name: string; url: string; savedAt: Date; status: string }, items: ObservedFeedItem[], format: FeedFormat) {
  const recent = items.slice(0,50);
  const updated = new Date(Math.max(source.savedAt.getTime(), ...recent.map(item=>item.updatedAt.getTime())));
  const feed = new Feed({ id:source.url, title:source.name, link:source.url, updated, copyright:'', generator:'Radar; feed@6.0.0',
    description:`Approved publisher observations. Source status: ${source.status}. Dates are Radar observations; publication dates are unknown.` });
  for (const item of recent) feed.addItem({
    id:`urn:sha256:${item.urlHash}`, link:item.url, title:format === 'atom' ? escapeHtml(item.title) : item.title,
    description:escapeHtml(`${item.summary}\nObserved by Radar: ${item.observedAt.toISOString()}. Publication date unknown.`),
    date:item.updatedAt,
  });
  if (format === 'rss') for (const item of feed.items) Reflect.deleteProperty(item,'date');
  const body = format === 'rss' ? feed.rss2() : format === 'atom' ? feed.atom1() : feed.json1();
  if (Buffer.byteLength(body) > 512_000) throw new Error('Generated feed exceeded 512 KB.');
  return { body, etag:`"${createHash('sha256').update(body).digest('hex')}"`, contentType:format === 'rss' ? 'application/rss+xml' : format === 'atom' ? 'application/atom+xml' : 'application/feed+json' };
}
