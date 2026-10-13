import { extractResearchSources, searchResearchWeb } from './tavily-research';
import { researchGateway, searchGatewayWeb } from './gateway-search';
import { mergeResearchSources, withinResearchDeadline } from './web-research';
import { fetchArticles, fetchArticleText } from './article-text';
import { fetchPublicText } from './public-http';
import { cleanStoredText } from './text-clean';
import { publisherHasAccessBarrier } from './feed-from-page';
import type { ResearchSource, ResearchFailureCategory } from './web-research-types';

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
export function researchReadFailure(error: unknown): { failureCategory: ResearchFailureCategory; httpStatus?: number } {
  const message = error instanceof Error ? error.message : '';
  const status = /^Public HTTP status ([1-5]\d{2})$/.exec(message);
  if (status) return { failureCategory: 'http_status', httpStatus: Number(status[1]) };
  if (/^(?:Public (?:HTTP|DNS) timeout|Research reached its time limit\.|Research source timeout)/.test(message)
    || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))) return { failureCategory: 'timeout' };
  if (/^Robots (?:disallowed|denied|refused)\b/i.test(message)) return { failureCategory: 'robots' };
  if (message === 'Research read barrier') return { failureCategory: 'barrier' };
  if (/^(?:Non-public or unresolved HTTP target|Only public HTTP|Public HTTP (?:target|redirect|bound|encoding|body)|Too many public HTTP redirects)/.test(message)) return { failureCategory: 'guard' };
  return { failureCategory: 'network' };
}

const failureText: Record<ResearchFailureCategory, string> = {
  robots: 'Reading was refused by a robots guard.', http_status: 'The public page returned an unsuccessful HTTP status.',
  timeout: 'The bounded source reading deadline expired.', barrier: 'An access barrier prevents reading this public page.',
  non_html: 'The response is not an HTML article.', guard: 'The public reader guard refused this source or found insufficient article text.',
  network: 'The public page could not be reached.',
};

export async function readResearchSources(sources: ResearchSource[], key: string | undefined, timeoutMs: number,
  readers: { tavily: typeof extractResearchSources; articles: typeof fetchArticles; fetchPage?: typeof fetchPublicText } = { tavily: extractResearchSources, articles: fetchArticles }): Promise<ResearchSource[]> {
  const started = Date.now(), deadline = started + timeoutMs;
  let extracted = sources;
  if (key) {
    const extractStarted = Date.now(), extractDeadline = extractStarted + Math.max(1, Math.min(12_000, Math.floor(timeoutMs * 0.6)));
    try {
      extracted = await withinResearchDeadline(readers.tavily(sources, key, extractDeadline - Date.now()), extractDeadline);
      extracted = extracted.map(source => source.status === 'read' ? { ...source, elapsedMs: Date.now() - extractStarted, failureCategory: undefined, httpStatus: undefined, error: undefined } : source);
    } catch { extracted = sources; }
  }
  const unread = extracted.filter(source => source.status !== 'read');
  if (!unread.length) return extracted;
  const completed = new Map<number, ResearchSource>();
  const sourceStartedAt = new Map<string, number>();
  const elapsed = (url: string) => sourceStartedAt.has(url) ? Math.max(0, Date.now() - sourceStartedAt.get(url)!) : 0;
  const diagnostics = new Map<string, { failureCategory?: ResearchFailureCategory; httpStatus?: number; elapsedMs: number }>();
  let closed = false;
  const tracked = readers.articles(unread, 4, async url => {
    const sourceStarted = Date.now(), sourceDeadline = Math.min(deadline, sourceStarted + 12_000);
    let failure: ReturnType<typeof researchReadFailure> | undefined;
    try {
      if (sourceDeadline <= sourceStarted) throw Error('Research source timeout');
      const article = await withinResearchDeadline(fetchArticleText(url, async (target, options) => {
        try {
          const left = sourceDeadline - Date.now();
          if (left <= 0) throw Error('Research source timeout');
          if (!sourceStartedAt.has(url)) sourceStartedAt.set(url, Date.now());
          const response = await (readers.fetchPage ?? fetchPublicText)(target, { ...options, timeoutMs: Math.max(1, Math.min(12_000, left)) });
          if (response.contentType.toLowerCase().includes('html') && publisherHasAccessBarrier(response.text)) throw Error('Research read barrier');
          return response;
        } catch (error) { failure = researchReadFailure(error); throw error; }
      }), sourceDeadline);
      if (!article.ok && !failure) failure = { failureCategory: article.reason === 'not_html' ? 'non_html' : 'guard' };
      diagnostics.set(url, { ...failure, elapsedMs: elapsed(url) });
      return article;
    } catch (error) {
      diagnostics.set(url, { ...researchReadFailure(error), elapsedMs: elapsed(url) });
      return { ok: false, reason: 'unreachable' };
    }
  }, (id, article) => {
    if (closed || Date.now() > deadline) return;
    const source = unread.find(source => source.id === id);
    if (!source) return;
    const diagnostic = diagnostics.get(source.url) ?? { elapsedMs: Math.max(0, Date.now() - started) };
    const content = article.ok ? cleanStoredText(article.text, 6000).trim() : '';
    const failureCategory = diagnostic.failureCategory ?? 'guard';
    completed.set(id, content ? { ...source, text: content, status: 'read', reader: 'native', error: undefined, elapsedMs: diagnostic.elapsedMs, failureCategory: undefined, httpStatus: undefined } :
      { ...source, text: '', status: 'failed', error: failureText[failureCategory], failureCategory, httpStatus: diagnostic.httpStatus, elapsedMs: diagnostic.elapsedMs });
  });
  try {
    const settled = await withinResearchDeadline(Promise.allSettled([tracked]), deadline);
    if (Date.now() <= deadline && settled[0].status === 'fulfilled') for (const [id, article] of settled[0].value) {
      if (completed.has(id)) continue;
      const source = unread.find(source => source.id === id), content = cleanStoredText(article.text, 6000).trim();
      if (source && content) completed.set(id, { ...source, text: content, status: 'read', reader: 'native', error: undefined, elapsedMs: Math.max(0, Date.now() - started), failureCategory: undefined, httpStatus: undefined });
    }
  } catch { closed = true; }
  closed = true;
  return extracted.map(source => source.status === 'read' ? source : completed.get(source.id) ?? {
    ...source, text: '', status: 'failed', failureCategory: Date.now() >= deadline ? 'timeout' : 'network', httpStatus: undefined,
    elapsedMs: elapsed(source.url),
    error: Date.now() >= deadline ? sourceStartedAt.has(source.url) ? failureText.timeout : 'The reading budget expired before this source could start.' : failureText.network,
  });
}
