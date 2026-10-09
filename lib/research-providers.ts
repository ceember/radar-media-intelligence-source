import { extractResearchSources, searchResearchWeb } from './tavily-research';
import { researchGateway, searchGatewayWeb } from './gateway-search';
import { mergeResearchSources, withinResearchDeadline } from './web-research';
import { fetchArticles, fetchArticleText } from './article-text';
import { fetchPublicText } from './public-http';
import { cleanStoredText } from './text-clean';
import type { ResearchSource } from './web-research-types';

export async function searchWithProviders(query: string, key: string | undefined,
  gateway: ReturnType<typeof researchGateway>, timeoutMs: number,
  providers = { tavily: searchResearchWeb, gateway: searchGatewayWeb }): Promise<ResearchSource[]> {
  // Tavily stays first. Parallel discovery allows the gateway to survive Tavily quota/errors.
  const requests = [];
  if (key) requests.push(providers.tavily(query, key, Math.min(12_000, timeoutMs)));
  if (gateway) requests.push(providers.gateway(query, gateway, Math.min(30_000, timeoutMs)));
  const completed: (ResearchSource[] | undefined)[] = [];
  const tracked = requests.map((request, i) => request.then(value => { completed[i] = value; }));
  try { await withinResearchDeadline(Promise.allSettled(tracked), Date.now() + timeoutMs); } catch { /* Keep timely results if the other provider stalls. */ }
  if (!completed.some(value => value !== undefined)) throw Error('Research search providers failed or are unavailable. Try again later.');
  return mergeResearchSources(completed.flatMap(value => value ?? []));
}

/** Reuse the native guarded reader for gateway-only runs and pages Tavily could not extract. */
export async function readResearchSources(sources: ResearchSource[], key: string | undefined, timeoutMs: number,
  readers = { tavily: extractResearchSources, articles: fetchArticles }): Promise<ResearchSource[]> {
  const deadline = Date.now() + timeoutMs;
  let extracted = sources;
  if (key) {
    const extractDeadline = Date.now() + Math.max(1, Math.min(12_000, Math.floor(timeoutMs * 0.6)));
    try { extracted = await withinResearchDeadline(readers.tavily(sources, key, extractDeadline - Date.now()), extractDeadline); } catch { /* Try the native reader with the remaining budget. */ }
  }
  const unread = extracted.filter(s => s.status !== 'read');
  if (!unread.length) return extracted;
  const articles = await withinResearchDeadline(readers.articles(unread, 2, async url => {
    const left = deadline - Date.now();
    if (left < 100) return { ok: false, reason: 'unreachable' };
    return fetchArticleText(url, (target, options) => fetchPublicText(target, { ...options, timeoutMs: Math.max(1, Math.min(12_000, deadline - Date.now())) }));
  }), deadline).catch(() => new Map());
  return extracted.map(source => {
    if (source.status === 'read') return source;
    const article = articles.get(source.id), content = article && cleanStoredText(article.text, 6000).trim();
    return content ? { ...source, text: content, status: 'read', reader: 'native', error: undefined } :
      { ...source, text: '', status: 'failed', error: 'The public page could not be read; search snippets cannot support the answer.' };
  });
}
