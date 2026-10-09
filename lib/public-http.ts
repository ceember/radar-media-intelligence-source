import { lookup } from 'node:dns/promises';
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, writeSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

/** Only globally routable addresses may serve user-controlled feeds/articles. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  // Allow global unicast only; exclude transition/special/documentation ranges.
  const parts = address.toLowerCase().split(':');
  const first = parseInt(parts[0], 16), second = parseInt(parts[1] || '0', 16);
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002
    && !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
    && !(first === 0x3fff && second < 0x1000);
}

async function publicTarget(input: string) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only public HTTP(S) URLs without userinfo are allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(host);
  const addresses = family ? [{ address: host, family }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((r) => !isPublicAddress(r.address))) {
    throw new Error('Non-public or unresolved HTTP target');
  }
  return { url, address: addresses[0] };
}

/** Recheck target DNS before sending its public URL to an external reader. No content request. */
export async function validatePublicUrl(input: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([publicTarget(input), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Public DNS timeout')), 12_000);
    })]);
  } finally { clearTimeout(timer); }
}

/** Pure pre-DNS policy for each strict hop; no URL/credential reflection on failure. */
export function validateStrictTarget(input: string, hostname: string, visited: Set<string>, maxUrlBytes = 2_000): URL {
  if (Buffer.byteLength(input, 'utf8') > maxUrlBytes || /[\x00-\x1f\x7f]/.test(input))
    throw new Error('Public HTTP target invalid');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Public HTTP target invalid'); }
  if (url.protocol !== 'https:' || url.hostname !== hostname || url.username || url.password
      || url.hash || url.port || isIP(url.hostname) || visited.has(url.href))
    throw new Error('Public HTTP target invalid');
  visited.add(url.href);
  return url;
}

/** Check the raw Location value before URL() can normalize tabs or controls away. */
export function validateRedirectLocation(location: string | undefined, base: URL): string {
  if (!location || Buffer.byteLength(location, 'utf8') > 2_000
      || /[\x00-\x1f\x7f]/.test(location)) throw new Error('Public HTTP redirect invalid');
  try { return new URL(location, base).href; }
  catch { throw new Error('Public HTTP redirect invalid'); }
}

/** DNS is vetted once per hop and pinned at connect time, including redirects.
 * No global fetch interception, proxy use, or second hostname resolution.
 */
type PublicTextOptions = {
  headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number;
  allowedHostname?: string; maxRedirects?: number; method?: 'GET' | 'POST'; body?: string;
  maxUrlBytes?: number;
};
export function fetchPublicText(input: string, options: PublicTextOptions = {}) {
  return fetchPublicTextBounded(input, options, 20_000);
}
/** Archive indexes are slow. Only the fixed metadata endpoint gets the background lookup’s 240-second ceiling. */
export function fetchPublicArchiveIndex(input: string, options: PublicTextOptions = {}) {
  const url = validateStrictTarget(input, 'web.archive.org', new Set(), 8000);
  if (url.pathname !== '/cdx/search/cdx') throw Error('Public archive index target invalid');
  return fetchPublicTextBounded(input, { ...options, allowedHostname: 'web.archive.org', maxRedirects: 0,
    maxUrlBytes: 8000, maxBytes: 100_000, method: 'GET', body: undefined,
    headers: { ...options.headers, 'User-Agent': 'RadarBot/1.0 (+https://github.com/ceember/media-intelligence)', 'Accept-Encoding': 'identity' } }, 240_000);
}
/** The reviewed audit route alone may use 100 seconds; every ordinary public fetch keeps its 20-second ceiling. */
export function fetchPublicAuditGateway(input: string, options: PublicTextOptions & { allowedHostname: string; body: string }) {
  return fetchFixedGateway(input, options, '/audit-page', 100_000);
}
/** Search has its own 30-second ceiling; ordinary article/provider fetches remain at 20 seconds. */
export function fetchPublicSearchGateway(input: string, options: PublicTextOptions & { allowedHostname: string; body: string }) {
  return fetchFixedGateway(input, options, '/search', 30_000);
}
function fetchFixedGateway(input: string, options: PublicTextOptions & { allowedHostname: string; body: string }, path: '/search' | '/audit-page', ceiling: number) {
  const url = validateStrictTarget(input, options.allowedHostname, new Set());
  if (url.pathname !== path || url.search || Buffer.byteLength(options.body) > 4000) throw Error('Public gateway target invalid');
  return fetchPublicTextBounded(input, { ...options, headers: { ...options.headers, 'Content-Length': String(Buffer.byteLength(options.body)) }, method: 'POST', maxRedirects: 0 }, ceiling);
}
async function fetchPublicTextBounded(input: string, options: PublicTextOptions, timeoutCeiling: number): Promise<{ text: string; finalUrl: string; contentType: string;
  hops: { protocol: string; hostname: string; address: string }[]; bytes: number }> {
  const maxBytes = options.maxBytes ?? 2_000_000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2_000_000) throw new Error('Public HTTP bound invalid');
  const timeoutMs = options.timeoutMs ?? 12_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > timeoutCeiling) throw new Error('Public HTTP bound invalid');
  const maxRedirects = options.maxRedirects ?? 5;
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 5) throw new Error('Public HTTP bound invalid');
  const deadline = performance.now() + timeoutMs;
  let next = input;
  const visited = new Set<string>();
  const hops: { protocol: string; hostname: string; address: string }[] = [];
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (options.allowedHostname) {
      validateStrictTarget(next, options.allowedHostname, visited, options.maxUrlBytes ?? 2_000);
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error('Public HTTP timeout');
    // Bound DNS as well as the socket/stream; lookup itself cannot be aborted.
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const target = await Promise.race([
      publicTarget(next),
      new Promise<never>((_, reject) => { dnsTimer = setTimeout(() => reject(new Error('Public DNS timeout')), remaining); }),
    ]).finally(() => clearTimeout(dnsTimer));
    const { url, address } = target;
    if (deadline - performance.now() <= 0) throw new Error('Public HTTP timeout');
    hops.push({ protocol: url.protocol, hostname: url.hostname, address: address.address });
    const result = await new Promise<{ redirect?: string; text: string; contentType: string; bytes: number }>((resolve, reject) => {
      const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = request(url, {
        method: options.method ?? 'GET', headers: options.headers, agent: false, family: address.family,
        maxHeaderSize: 16_384,
        lookup: (_host, _opts, callback) => callback(null, address.address, address.family),
      }, async (res) => {
        try {
          const status = res.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = res.headers.location;
            res.destroy();
            resolve({ redirect: validateRedirectLocation(location, url), text: '', contentType: '', bytes: 0 });
            return;
          }
          if (options.allowedHostname ? status !== 200 : (status < 200 || status >= 300))
            throw new Error(`Public HTTP status ${status}`);
          if (options.allowedHostname && res.headers['content-encoding']
              && res.headers['content-encoding'] !== 'identity') throw new Error('Public HTTP encoding refused');
          if (Number(res.headers['content-length'] ?? 0) > maxBytes) throw new Error('Public HTTP body too large');
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of res) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > maxBytes) throw new Error('Public HTTP body too large');
            chunks.push(buffer);
          }
          resolve({ text: Buffer.concat(chunks).toString('utf8'), contentType: String(res.headers['content-type'] ?? ''), bytes });
        } catch (error) { res.destroy(); reject(error); }
      });
      const timer = setTimeout(() => req.destroy(new Error('Public HTTP timeout')), Math.max(1, deadline - performance.now()));
      req.on('error', reject);
      req.on('close', () => clearTimeout(timer));
      req.end(options.body);
    });
    if (!result.redirect) return { text: result.text, contentType: result.contentType, finalUrl: url.href,
      hops, bytes: result.bytes };
    if (options.method === 'POST' || hop >= maxRedirects) throw new Error('Too many public HTTP redirects');
    next = result.redirect;
  }
  throw new Error('Too many public HTTP redirects');
}

// Conservative whole-service bounds. Each provider call consumes a durable UTC-day
// slot before transport; uncertain responses and process exits never refund slots.
const PROVIDER_QUOTAS: Record<string, { id: string; perUtcDay: number }> = {
  'api.tavily.com': { id: 'tavily', perUtcDay: 5 },
  'newsdata.io': { id: 'newsdata', perUtcDay: 1 },
  'www.alphavantage.co': { id: 'alphavantage', perUtcDay: 1 },
  'api.football-data.org': { id: 'footballdata', perUtcDay: 2 },
  'www.googleapis.com': { id: 'youtube', perUtcDay: 2 },
  // Eligibility and billing remain closed even if a key is accidentally present.
  'api.podcastindex.org': { id: 'podcastindex', perUtcDay: 0 },
  'maps.googleapis.com': { id: 'googleplaces', perUtcDay: 0 },
};

function privateDirectory(path: string, create: boolean): void {
  if (create) {
    try { mkdirSync(path, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('Provider quota custody HOLD');
    }
  }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()
      || (stat.mode & 0o777) !== 0o700) throw new Error('Provider quota custody HOLD');
}

function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Cross-process O_EXCL slots bound direct routes and connector workers together. */
export function reserveProviderQuota(hostname: string, now = new Date(), dataRoot = process.env.RADAR_PROVIDER_QUOTA_ROOT): void {
  // Open test deployment has no private filesystem; provider free tiers bound usage.
  if (process.env.RADAR_OPEN_TEST === '1') return;
  if (!dataRoot || !dataRoot.startsWith('/') || resolve(dataRoot) !== dataRoot)
    throw new Error('Provider quota custody HOLD');
  const policy = PROVIDER_QUOTAS[hostname];
  if (!policy || policy.perUtcDay === 0 || !Number.isFinite(now.getTime()))
    throw new Error('Provider quota HOLD');
  privateDirectory(dataRoot, false);
  const root = `${dataRoot}/provider-quota`;
  // Never recreate missing quota custody after a PGlite-only disaster restore.
  // The owner provisions these private directories once under an activation receipt.
  privateDirectory(root, false);
  const provider = `${root}/${policy.id}`;
  privateDirectory(provider, false);
  const day = now.toISOString().slice(0, 10);
  if (readdirSync(provider).some((name) => /^\d{4}-\d\d-\d\d$/.test(name) && name > day))
    throw new Error('Provider quota clock HOLD');
  const period = `${provider}/${day}`;
  privateDirectory(period, true);
  syncDirectory(provider);
  if (policy.id === 'tavily' && readdirSync(period).some((name) => !/^(0[0-4])\.json$/.test(name)))
    throw new Error('Provider quota custody HOLD');
  for (let slot = 0; slot < policy.perUtcDay; slot++) {
    const target = `${period}/${slot.toString().padStart(2, '0')}.json`;
    let fd: number;
    try {
      fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw new Error('Provider quota custody HOLD');
    }
    try {
      writeSync(fd, JSON.stringify({ provider: policy.id, utcDay: day, slot, reservedAt: now.toISOString() }));
      fsyncSync(fd);
    } finally { closeSync(fd); }
    syncDirectory(period);
    return;
  }
  throw new Error('Provider quota exhausted');
}

/** Exact-host, no-redirect provider JSON. Error text never includes URL, body or credentials. */
export async function fetchBoundedProviderJson<T>(input: string, options: {
  hostname: string; headers?: Record<string, string>; method?: 'GET' | 'POST'; body?: string;
  timeoutMs?: number; maxBytes?: number;
}): Promise<T> {
  validateStrictTarget(input, options.hostname, new Set());
  reserveProviderQuota(options.hostname);
  let text: string;
  try {
    ({ text } = await fetchPublicText(input, {
      headers: { 'Accept-Encoding': 'identity', ...options.headers },
      method: options.method, body: options.body,
      timeoutMs: options.timeoutMs ?? 12_000, maxBytes: options.maxBytes ?? 256_000,
      allowedHostname: options.hostname, maxRedirects: 0,
    }));
  } catch { throw new Error('Provider request failed'); }
  try { return JSON.parse(text) as T; } catch { throw new Error('Provider JSON invalid'); }
}
