/** Local-only proposal for one synthetic project's RSS + HN ingestion.
 * The installed adapter must supply the source-bound public HTTP, lease and DB functions.
 */
import { isIP } from 'node:net';
export type Project = {
  id: number; ownerId: number | null; name: string; mode: string; visibility: string;
  keywords: string[]; rssFeeds: string[]; queryPlan: unknown;
  allTerms: string[]; excludeTerms: string[]; telegramChannels: string[];
  talkwalkerProject: string | null; talkwalkerTopics: string[]; evidenceTerms: string[];
};
export type Env = Record<string, string | undefined>;
export type Raw = {
  source: 'rss' | 'hackernews'; externalId: string; title: string;
  content: string; url: string; publishedAt: Date; author?: string; community?: string;
};
export type Hop = { protocol: string; hostname: string; address: string };
export type FetchResult = { items: Raw[]; hops: Hop[]; status: number; bytes: number };
export type NewRow = Raw & { projectId: number; kind: 'article' | 'post' };
export type Receipt = { candidateSha256: string; dataSha256: string; verifiedAt: string; transactionRollbackReady: true };
export type Deps = {
  now: () => Date;
  isPublicAddress: (address: string) => boolean;
  noBenchmarkEntities: (projectId: number) => Promise<boolean>;
  withDailyLease: <T>(projectId: number, utcDay: string, work: () => Promise<T>) => Promise<T>;
  verifySnapshot: () => Promise<Receipt>;
  fetchRss: (url: string, bounds: Bounds) => Promise<FetchResult>;
  fetchHn: (term: string, bounds: Bounds) => Promise<FetchResult>;
  insertNew: (rows: NewRow[]) => Promise<{ inserted: number; keys: string[] }>;
};
export type Bounds = { hostname: string; maxRedirects: number; timeoutMs: number; maxBytes: number };
export type Config = { projectId: number; ownerId: number; projectName: string; keyword: string; rssUrl: string; candidateSha256: string };
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_ITEMS = 90; // RSS 40 + HN 50, one feed and one term.
function hold(): never { throw new Error('HOLD: narrow public ingestion prerequisite failed'); }
function validHttps(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { return hold(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) hold();
  return url;
}
function exactArray(value: unknown, expected: string[] = []): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((v, i) => v === expected[i]);
}
export function preflight(env: Env, project: Project, config: Config): { feedHost: string } {
  // Global AI/source keys may be active. This route has hardcoded RSS+HN adapters;
  // it never resolves a connector by global allowlist or imports AI/provider code.
  if (env.RADAR_RETENTION_DISABLED !== '1' || env.DATABASE_URL
      || 'DEMO_MODE' in env) hold();
  if (!Number.isSafeInteger(config.projectId) || config.projectId <= 0
      || !Number.isSafeInteger(config.ownerId) || config.ownerId <= 0
      || !HEX64.test(config.candidateSha256)
      || project.id !== config.projectId || project.ownerId !== config.ownerId
      || project.name !== config.projectName
      || config.projectName !== 'SYNTHETIC_SCHEDULER26' || project.mode !== 'listening'
      || project.visibility !== 'private' || !exactArray(project.keywords, [config.keyword])
      || !exactArray(project.rssFeeds, [config.rssUrl])
      || project.queryPlan != null || !exactArray(project.allTerms)
      || !exactArray(project.excludeTerms) || !exactArray(project.telegramChannels)
      || project.talkwalkerProject != null || !exactArray(project.talkwalkerTopics)
      || !exactArray(project.evidenceTerms)
      || !/^[A-Za-z0-9_-]{8,64}$/.test(config.keyword)) hold();
  const feed = validHttps(config.rssUrl);
  if (feed.hostname !== feed.hostname.toLowerCase()
      || isIP(feed.hostname.replace(/^\[|\]$/g, ''))
      || feed.hostname === 'localhost' || feed.hostname.endsWith('.localhost')
      || feed.hostname.endsWith('.local') || feed.hostname.endsWith('.internal')) hold();
  return { feedHost: feed.hostname };
}
function checkFetch(result: FetchResult, expectedHost: string, maxRedirects: number,
                    maxBytes: number, isPublicAddress: Deps['isPublicAddress']): void {
  if (result.status !== 200 || !Number.isSafeInteger(result.bytes) || result.bytes <= 0
      || result.bytes > maxBytes || !Array.isArray(result.items) || result.items.length === 0
      || !Array.isArray(result.hops) || result.hops.length < 1
      || result.hops.length > maxRedirects + 1) hold();
  for (const hop of result.hops) {
    if (hop.protocol !== 'https:' || hop.hostname !== expectedHost
        || !isPublicAddress(hop.address)) hold();
  }
}
function key(row: Raw): string { return `${row.source}\u0000${row.externalId}`; }
function rowsFor(items: Raw[], source: Raw['source'], projectId: number,
                 host: string, keyword: string, now: Date): NewRow[] {
  const seen = new Set<string>();
  const out: NewRow[] = [];
  for (const item of items) {
    if (item.source !== source || typeof item.externalId !== 'string'
        || item.externalId.length < 1 || item.externalId.length > 500
        || typeof item.title !== 'string' || typeof item.content !== 'string'
        || item.title.length < 1 || item.title.length > 500 || item.content.length > 1200
        || typeof item.url !== 'string' || item.url.length > 2000
        || !item.publishedAt || !(item.publishedAt instanceof Date)
        || !Number.isFinite(item.publishedAt.getTime())) hold();
    const url = validHttps(item.url);
    if (url.hostname !== host || !`${item.title} ${item.content}`.toLowerCase().includes(keyword.toLowerCase())) continue;
    const age = now.getTime() - item.publishedAt.getTime();
    if (age > 90 * 86400_000 || age < -3600_000) continue;
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...item, projectId, kind: source === 'rss' ? 'article' : 'post' });
  }
  return out;
}
/** Lease and snapshot are required injected owner controls; missing adapters cannot be bypassed. */
export async function runNarrow(env: Env, project: Project, config: Config, deps: Deps) {
  const { feedHost } = preflight(env, project, config);
  if (!await deps.noBenchmarkEntities(config.projectId)) hold();
  const now = deps.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) hold();
  const day = now.toISOString().slice(0, 10);
  return deps.withDailyLease(config.projectId, day, async () => {
    const snapshot = await deps.verifySnapshot();
    const verifiedAt = Date.parse(snapshot.verifiedAt);
    if (snapshot.transactionRollbackReady !== true || snapshot.candidateSha256 !== config.candidateSha256
        || !HEX64.test(snapshot.dataSha256) || !Number.isFinite(verifiedAt)
        || verifiedAt > now.getTime() || now.getTime() - verifiedAt > 15 * 60_000) hold();
    const rssBound: Bounds = { hostname: feedHost, maxRedirects: 2, timeoutMs: 12_000, maxBytes: 2_000_000 };
    const hnBound: Bounds = { hostname: 'hn.algolia.com', maxRedirects: 0, timeoutMs: 12_000, maxBytes: 1_000_000 };
    // Fetch both before the first insert: a swallowed or failed source cannot become a green partial tick.
    const rss = await deps.fetchRss(config.rssUrl, rssBound);
    checkFetch(rss, feedHost, 2, rssBound.maxBytes, deps.isPublicAddress);
    const hn = await deps.fetchHn(config.keyword, hnBound);
    checkFetch(hn, hnBound.hostname, 0, hnBound.maxBytes, deps.isPublicAddress);
    if (rss.items.length > 40 || hn.items.length > 50 || rss.items.length + hn.items.length > MAX_ITEMS) hold();
    const rssRows = rowsFor(rss.items, 'rss', config.projectId, feedHost, config.keyword, now);
    const hnRows = rowsFor(hn.items, 'hackernews', config.projectId,
                           'news.ycombinator.com', config.keyword, now);
    if (rssRows.length === 0 || hnRows.length === 0) hold();
    const rows = [...rssRows, ...hnRows];
    const inserted = await deps.insertNew(rows);
    if (!Number.isSafeInteger(inserted.inserted) || inserted.inserted < 0 || inserted.inserted > rows.length
        || !Array.isArray(inserted.keys) || inserted.keys.length !== inserted.inserted
        || inserted.keys.some((k) => !rows.some((r) => key(r) === k))
        || new Set(inserted.keys).size !== inserted.keys.length) hold();
    return { projectId: config.projectId, day, fetched: { rss: rss.items.length, hackernews: hn.items.length },
             validUnique: rows.length, inserted: inserted.inserted,
             requestHops: { rss: rss.hops.length, hackernews: hn.hops.length },
             snapshotSha256: snapshot.dataSha256 };
  });
}
