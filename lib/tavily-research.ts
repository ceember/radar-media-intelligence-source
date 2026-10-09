import { isIP } from 'node:net';
import { fetchPublicText, isPublicAddress } from '@/lib/public-http';
import { getStoredKey } from '@/lib/connector-credentials';
import { cfg } from '@/lib/connector-config';
import type { ResearchSource } from './web-research-types';

export async function researchTavilyKey() {
  if (process.env.RADAR_CREDENTIAL_FREE === '1') return undefined;
  if (process.env.RADAR_SOURCE_ALLOWLIST !== undefined) return cfg('TAVILY_API_KEY');
  return (await getStoredKey('TAVILY_API_KEY')) || cfg('TAVILY_API_KEY');
}

export function researchPublicUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000 || /[\u0000-\u0020\u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw), host = url.hostname.replace(/^\[|\]$/g, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
      || (isIP(host) ? !isPublicAddress(host) : !host.includes('.') || /\.(?:localhost|local|internal|test|invalid)$/i.test(host))) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function text(value: unknown, limit: number) {
  return typeof value === 'string' ? value.replace(/\u0000/g, '').slice(0, limit).toWellFormed() : '';
}

/** Called only after the route atomically reserves a DB research slot. No LinkedIn filter or filesystem-quota bypass. */
async function tavily(path: 'search' | 'extract', body: object, key: string, timeoutMs: number): Promise<Record<string, unknown>> {
  try {
    const result = await fetchPublicText(`https://api.tavily.com/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept-Encoding': 'identity' },
      body: JSON.stringify(body), allowedHostname: 'api.tavily.com', maxRedirects: 0,
      timeoutMs: Math.min(20_000, timeoutMs), maxBytes: 600_000,
    });
    const data: unknown = JSON.parse(result.text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid');
    return data as Record<string, unknown>;
  } catch { throw new Error(`Tavily ${path} failed or timed out. No provider response was used.`); }
}

export async function searchResearchWeb(query: string, key: string, timeoutMs: number): Promise<ResearchSource[]> {
  const data = await tavily('search', { query, topic: 'general', search_depth: 'basic', max_results: 5,
    include_answer: false, include_raw_content: false, include_images: false, auto_parameters: false }, key, timeoutMs);
  if (!Array.isArray(data.results) || data.results.length > 5) throw new Error('Tavily search response was invalid.');
  return data.results.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>, url = researchPublicUrl(item.url);
    return url ? [{ id: 0, title: text(item.title, 300) || url, url, snippet: text(item.content, 1600), text: '', status: 'pending' as const, providers: ['tavily' as const] }] : [];
  });
}

export async function extractResearchSources(sources: ResearchSource[], key: string, timeoutMs: number): Promise<ResearchSource[]> {
  let data: Record<string, unknown>;
  try {
    data = await tavily('extract', { urls: sources.map((s) => s.url), extract_depth: 'basic', format: 'text',
      include_images: false, timeout: Math.max(1, Math.min(15, timeoutMs / 1000 - 1)) }, key, timeoutMs);
  } catch {
    return sources.map((s) => ({ ...s, status: 'failed', error: 'Extraction request failed or timed out.' }));
  }
  const results = Array.isArray(data.results) ? data.results : [];
  const failed = Array.isArray(data.failed_results) ? data.failed_results : [];
  // Provider output order is unspecified. Match by URL, never by array position.
  return sources.map((source) => {
    const result = results.find((r) => r && typeof r === 'object' && researchPublicUrl(r.url) === source.url);
    const content = text(result?.raw_content, 6000).trim();
    if (content) return { ...source, text: content, status: 'read', reader: 'tavily-extract' };
    const knownFailure = failed.some((r) => r && typeof r === 'object' && researchPublicUrl(r.url) === source.url);
    return { ...source, status: 'failed', error: knownFailure ? 'Tavily could not extract this page.' : 'No extracted text was returned for this page.' };
  });
}
