import robotsParser from 'robots-parser';
import { utf8Bound, type CrawlEvidence } from './competitor-page';

export const COMPETITOR_USER_AGENT = 'RadarBot/1.0';
export function competitorCrawlPolicy(pageUrl: string, body: string | null, checkedAt: string, failure?: string, httpStatus: number | null = null): CrawlEvidence {
  const url = new URL(pageUrl), origin = url.origin;
  const result: CrawlEvidence = { status: 'unknown', origin, userAgent: COMPETITOR_USER_AGENT, checkedAt,
    rule: null, delay: 1, sitemaps: [], httpStatus, accessCase: body === null ? 'unreachable' : 'rules',
    reason: failure ?? 'Robots policy could not be established; capture halted.' };
  // RFC 9309 section 2.3.1.3: unavailable (4xx) means no rules. Never apply this to network failures.
  if (httpStatus !== null && httpStatus >= 400 && httpStatus <= 499) return { ...result, status: 'allowed', accessCase: 'unavailable',
    reason: `Robots HTTP ${httpStatus}: unavailable; no rules apply (RFC 9309 section 2.3.1.3).` };
  if (httpStatus !== null && httpStatus >= 500) return { ...result, accessCase: 'unreachable',
    reason: `Robots HTTP ${httpStatus}: unreachable; capture halted (RFC 9309 section 2.3.1.4).` };
  if (body === null || Buffer.byteLength(body) > 50_000 || /<\s*(?:!doctype|html|body)\b/i.test(body) ||
    !/^\s*user-agent\s*:\s*\S+/im.test(body)) return result;
  const lines = body.split(/\r?\n/);
  // Unknown directives can be harmless, but malformed standard directives cannot grant access.
  if (lines.some((line) => /^(user-agent|allow|disallow|crawl-delay|sitemap)\b/i.test(line.trim()) &&
    !/^\s*(user-agent|allow|disallow|crawl-delay|sitemap)\s*:/i.test(line))) return result;
  if (lines.some((line) => {
    const field = line.split('#', 1)[0].match(/^\s*(user-agent|allow|disallow|crawl-delay)\s*:\s*(.*?)\s*$/i);
    if (!field) return false;
    if (field[1].toLowerCase() === 'user-agent') return !field[2];
    if (field[1].toLowerCase() === 'crawl-delay') return !/^\d+(?:\.\d+)?$/.test(field[2]) || !Number.isFinite(Number(field[2]));
    return field[2] !== '' && !/^[/*]/.test(field[2]);
  })) return result;
  try {
    const parser = robotsParser(`${origin}/robots.txt`, body);
    const allowed = parser.isAllowed(pageUrl, COMPETITOR_USER_AGENT);
    const delay = parser.getCrawlDelay(COMPETITOR_USER_AGENT);
    if (allowed === undefined || (delay !== undefined && (!Number.isFinite(delay) || delay < 0))) return result;
    result.status = allowed ? 'allowed' : 'disallowed';
    const rule = lines[parser.getMatchingLineNumber(pageUrl, COMPETITOR_USER_AGENT) - 1]?.trim();
    result.rule = rule ? utf8Bound(rule, 500) : null;
    result.delay = Math.max(1, delay ?? 0);
    result.sitemaps = parser.getSitemaps().slice(0, 10).flatMap((value) => {
      try { const s = new URL(value); return s.protocol === 'https:' && !s.username && !s.password ? [s.href.slice(0, 1800)] : []; } catch { return []; }
    });
    result.reason = allowed ? 'Allowed by the applicable robots rules; this does not establish permission under site terms.' : 'Disallowed by the applicable robots rule; capture halted.';
    return result;
  } catch { return result; }
}
