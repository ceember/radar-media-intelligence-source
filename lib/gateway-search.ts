import { fetchPublicSearchGateway } from './public-http';
import { toolsGateway } from './mi-tools-gateway';
import { researchPublicUrl } from './tavily-research';
import { cleanStoredText } from './text-clean';
import type { ResearchSource } from './web-research-types';

export function researchGateway() {
  return process.env.RADAR_CREDENTIAL_FREE === '1' ? null : toolsGateway('search');
}

/** Search snippets are discovery evidence only. Reading must fetch the actual page separately. */
export function parseGatewaySearch(value: unknown, bearerToken?: string): ResearchSource[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Gateway search response was invalid.');
  const data = value as Record<string, unknown>;
  if (data.error || !Array.isArray(data.results) || data.results.length > 10) throw Error('Gateway search response was invalid.');
  return data.results.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    const fields = [item.title, item.content, item.url];
    if (bearerToken && fields.some(field => typeof field === 'string'
      && (field.includes(bearerToken) || cleanStoredText(field).includes(bearerToken)))) throw Error('Gateway search response was invalid.');
    const url = researchPublicUrl(item.url);
    if (!url || typeof item.title !== 'string' || typeof item.content !== 'string') return [];
    const title = cleanStoredText(item.title, 300) || url, snippet = cleanStoredText(item.content, 1600);
    if (bearerToken && [title, url, snippet].some(field => field.includes(bearerToken))) throw Error('Gateway search response was invalid.');
    return [{ id: 0, title, url, snippet, text: '', status: 'pending' as const, providers: ['f9' as const] }];
  });
}

export async function searchGatewayWeb(query: string, gateway: NonNullable<ReturnType<typeof researchGateway>>,
  timeoutMs: number, fetchPage = fetchPublicSearchGateway): Promise<ResearchSource[]> {
  if (!query.trim() || Array.from(query).length > 300) throw Error('Gateway search query was invalid.');
  try {
    const response = await fetchPage(gateway.endpoint, { allowedHostname: gateway.hostname,
      method: 'POST', body: JSON.stringify({ query: cleanStoredText(query) }), maxBytes: 600_000,
      timeoutMs: Math.min(30_000, Math.max(1, Math.floor(timeoutMs))),
      headers: { Authorization: `Bearer ${gateway.token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'identity' } });
    if (!/^application\/json\b/i.test(response.contentType) || Buffer.byteLength(response.text) > 600_000 || response.text.includes(gateway.token)) throw Error('invalid');
    return parseGatewaySearch(JSON.parse(response.text), gateway.token);
  } catch { throw Error('Gateway search failed or timed out. No provider response was used.'); }
}
