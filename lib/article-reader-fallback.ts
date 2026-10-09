import { createHash } from 'node:crypto';
import { fetchArticleText, isOpaqueRedirect } from './article-text';
import { fetchPublicText, validatePublicUrl } from './public-http';
import { researchPublicUrl } from './tavily-research';
import { cleanStoredText } from './text-clean';
import { ARTICLE_MAX_CHARS, type ExtractedArticle } from './article-extract';
import { load } from 'cheerio/slim';
import type { ReaderReason } from './article-reader-reasons';

export type ReaderState = {
  status: 'reading' | 'native' | 'read' | 'unavailable' | 'restricted' | 'throttled';
  provider: 'native' | 'jina'; originalUrl: string; checkedAt: string; permissionConfirmedAt: string;
  reason?: ReaderReason;
};
export type ReaderResult = { state: ReaderState; article?: ExtractedArticle };

/** Conservative gate: rendered reading must never try to get around an access barrier. */
export function restrictedReading(text: string): boolean {
  return /"isAccessibleForFree"\s*:\s*(?:false|"false")|type\s*=\s*["']password|(?:id|class)\s*=\s*["'][^"']*(?:paywall|captcha|challenge-form)|sign in to (?:read|continue)|log in to (?:read|continue)|subscribe to (?:read|continue)|verify (?:that )?you are (?:a )?human|access denied|enable javascript and cookies to continue/i.test(text);
}

/** Attribute parsing covers unquoted/module attributes and common Nuxt/Angular shells. */
export function hasRenderedShell(html: string): boolean {
  const $=load(html);
  if($('script[src],script[type="module"],#root,#app,#__next,#__nuxt,#app-root,app-root,[data-reactroot],[ng-version]').length) return true;
  return $('script').toArray().some(node=>$(node).attr('type')!=='application/ld+json'&&/ReactDOM\.|hydrateRoot\s*\(|__NUXT__|createApp\s*\(/.test($(node).text()));
}

/** One user-approved article per action, never invoked by automatic ingestion. */
export async function readPublicArticle(originalUrl: string, permission: boolean, deps: {
  fetchPage: typeof fetchPublicText; validate: typeof validatePublicUrl; reserve: () => Promise<boolean>;
}): Promise<ReaderResult> {
  const checkedAt = new Date().toISOString();
  const state: ReaderState = { status: 'unavailable', provider: 'native', originalUrl: cleanStoredText(originalUrl, 2000),
    checkedAt, permissionConfirmedAt: permission ? checkedAt : '' };
  const result = (status: ReaderState['status'], reason: ReaderReason, article?: ExtractedArticle): ReaderResult => {
    console.info('[article-reader]', { status, reason, provider: state.provider });
    return { state: { ...state, status, reason }, ...(article ? { article } : {}) };
  };
  const target = researchPublicUrl(originalUrl);
  if (!permission) return result('unavailable','permission_missing');
  if (!target) return result('unavailable','invalid_url');
  if (isOpaqueRedirect(target)) return result('unavailable','opaque_redirect');
  let page: Awaited<ReturnType<typeof fetchPublicText>> | undefined;
  let restricted = false;
  const native = await fetchArticleText(target, async (url, options) => {
    page = await deps.fetchPage(url, options);
    restricted = restrictedReading(page.text);
    if (restricted) throw new Error('Restricted source');
    return page;
  });
  if (restricted) return result('restricted','publisher_restricted');
  if (native.ok) return result('native','native_readable', native);
  if (native.reason !== 'too_short') return result('unavailable',native.reason==='not_html'?'native_not_html':native.reason==='opaque_redirect'?'opaque_redirect':'native_unreachable');
  if (!page) return result('unavailable','native_unreachable');
  // Approval covers this origin only. Do not forward redirects to a different publisher.
  const forwarded = researchPublicUrl(page.finalUrl);
  if (!forwarded || new URL(forwarded).origin !== new URL(target).origin) return result('unavailable','origin_changed');
  // A short article/teaser alone is not evidence that rendering is needed.
  if (!hasRenderedShell(page.text)) return result('unavailable','no_rendered_shell');
  try { await deps.validate(forwarded); } catch { return result('unavailable','target_validation_failed'); }
  state.provider = 'jina';
  try { if (!await deps.reserve()) return result('throttled','quota_exceeded'); }
  catch { return result('unavailable','quota_unavailable'); }
  try {
    const response = await deps.fetchPage(`https://r.jina.ai/${forwarded}`, {
      headers: { 'x-respond-with': 'markdown', 'x-robots-txt': 'RadarBot', DNT: '1', 'Accept-Encoding': 'identity' },
      allowedHostname: 'r.jina.ai', maxRedirects: 0, maxUrlBytes: 2100, timeoutMs: 20_000, maxBytes: 1_000_000,
    });
    if (restrictedReading(response.text)) return result('restricted','outside_restricted');
    if (!/text\/(?:plain|markdown)/i.test(response.contentType)) return result('unavailable','outside_content_type');
    const text = cleanStoredText(response.text, ARTICLE_MAX_CHARS).trim();
    if (text.length < 320) return result('unavailable','outside_too_short');
    return result('read','outside_read', { text, metadata: { method: 'jina', version: 'reader-api', title: null, byline: null,
      sourceUrl: forwarded, canonicalUrl: forwarded, checkedAt, inputHash: createHash('sha256').update(response.text).digest('hex') } });
  } catch (error) {
    const message=error instanceof Error?error.message:'';
    if (/status 429\b/i.test(message)) return result('throttled','outside_rate_limited');
    const reason=/status (?:401|403|409|451)\b/i.test(message)?'outside_refused':/timeout|timed out|abort/i.test(message)?'outside_timed_out':/too large|byte limit/i.test(message)?'outside_too_large':'outside_failed';
    return result('unavailable',reason);
  }
}
