import { createHash } from 'node:crypto';
import { load } from 'cheerio/slim';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { cleanStoredText } from './text-clean';

export const ARTICLE_MAX_BYTES = 2_000_000;
export const ARTICLE_MAX_CHARS = 20_000;
const MIN_CHARS = 320;
export type ArticleMetadata = {
  method: 'readability' | 'cheerio' | 'jina';
  version: string;
  title: string | null;
  byline: string | null;
  sourceUrl: string;
  canonicalUrl: string;
  checkedAt: string;
  inputHash: string;
};
export type ExtractedArticle = { text: string; metadata: ArticleMetadata };

const normalize = (text: string) => cleanStoredText(text).replace(/\s+/g, ' ').trim();
const bounded = (text: string | undefined | null) => cleanStoredText(normalize(text ?? ''), 300) || null;

/** Parse only already-fetched evidence. Neither DOM parser executes code or fetches links. */
export function extractArticleHtml(html: string, sourceUrl: string,
  checkedAt = new Date().toISOString()): ExtractedArticle | null {
  if (Buffer.byteLength(html, 'utf8') > ARTICLE_MAX_BYTES) return null;
  const source = new URL(cleanStoredText(sourceUrl));
  const $ = load(html);
  let canonicalUrl = source.href;
  try {
    const candidate = new URL($('link[rel="canonical"]').attr('href') ?? source.href, source);
    if (candidate.origin === source.origin && !candidate.username && !candidate.password) {
      candidate.hash = '';
      canonicalUrl = candidate.href;
    }
  } catch { /* A bad publisher canonical link never replaces the fetched source. */ }
  const title = bounded($('h1').first().text() || $('title').first().text());
  const byline = bounded($('meta[name="author"]').attr('content'));
  $('script,style,noscript,svg,form,nav,header,footer,aside,iframe,template,[hidden],[aria-hidden="true"],base').remove();
  // linkedom's baseURI gives Readability a deterministic source for relative links.
  $('<base>').attr('href', source.href).prependTo('head');
  let text = '', method: ArticleMetadata['method'] = 'readability';
  let extractedTitle = title, extractedByline = byline;
  try {
    const { document } = parseHTML($.html());
    const article = new Readability(document, { charThreshold: MIN_CHARS }).parse();
    if (article) {
      const body = load(article.content ?? '', undefined, false);
      const blocks = body('p,h2,h3,h4,li,blockquote').toArray()
        .map(node => normalize(body(node).text())).filter(Boolean);
      text = blocks.length ? blocks.join('\n\n') : normalize(article.textContent ?? '');
      extractedTitle = bounded(article.title) ?? title;
      extractedByline = bounded(article.byline) ?? byline;
    }
  } catch { /* A DOM compatibility failure can still use the structural fallback. */ }
  if (text.length < MIN_CHARS) {
    method = 'cheerio';
    const containers = $('article,main,.article-body,.story-body,.entry-content,.post-content').toArray();
    const candidates = containers.length ? containers : $('body').toArray();
    text = candidates.map(node => $(node).find('p').toArray()
      .map(p => normalize($(p).text())).filter(Boolean).join('\n\n'))
      .sort((a, b) => b.length - a.length)[0] ?? '';
  }
  if (text.length < MIN_CHARS) return null;
  return {
    text: cleanStoredText(text, ARTICLE_MAX_CHARS),
    metadata: {
      method,
      version: method === 'readability' ? 'readability@0.6.0+linkedom@0.18.13' : 'cheerio@1.2.0',
      title: extractedTitle, byline: extractedByline, sourceUrl: cleanStoredText(source.href),
      canonicalUrl: cleanStoredText(canonicalUrl), checkedAt: cleanStoredText(checkedAt), inputHash: createHash('sha256').update(html).digest('hex'),
    },
  };
}
