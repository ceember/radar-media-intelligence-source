import type { Connector, RawMention } from './types';
import { booleanQuery } from './types';
import { truncate } from './util';
import { cfg, sourceAllowed } from '@/lib/connector-config';
import { fetchBoundedProviderJson } from '@/lib/public-http';

// LinkedIn (web): post e articoli PUBBLICI di terzi trovati tramite l'indice di
// ricerca Tavily (API ufficiale, piano gratuito 1.000 ricerche/mese; a noi ne
// serve 1 per progetto per ciclo). Modello di acquisizione DIVERSO da
// "LinkedIn (page)" (API ufficiale LinkedIn): qui arrivano estratti parziali,
// senza metriche di engagement, ma di qualsiasi autore pubblico.
// Legale: si interroga l'API di Tavily, non i server LinkedIn.
// Si attiva con TAVILY_API_KEY (da app.tavily.com).

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
};

/** "Mario Rossi on LinkedIn: testo…" / "… | LinkedIn" → autore e titolo puliti. */
function parseTitle(raw: string): { author?: string; title: string } {
  const m = raw.match(/^(.{2,80}?) (?:on|su|auf|en|sur) LinkedIn[:：]\s*(.*)$/i);
  if (m) return { author: m[1].trim(), title: m[2].trim() || m[1].trim() };
  return { title: raw.replace(/\s*[|–-]\s*LinkedIn\s*$/i, '').trim() };
}

export const linkedinWeb: Connector = {
  id: 'linkedin_web',
  label: 'LinkedIn (web)',
  tier: 'freekey',
  enabled: () => sourceAllowed('linkedin_web', 'freekey') && Boolean(cfg('TAVILY_API_KEY')),
  disabledReason: 'Requires a free Tavily API key (app.tavily.com, 1,000 searches/month): enter it here',
  async fetchMentions(q) {
    if (!linkedinWeb.enabled()) return [];
    const query = booleanQuery(q);
    if (!query) return [];

    const data = await fetchBoundedProviderJson<{ results?: TavilyResult[] }>('https://api.tavily.com/search', {
      hostname: 'api.tavily.com', method: 'POST', maxBytes: 256_000, timeoutMs: 12_000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg('TAVILY_API_KEY')}`,
      },
      body: JSON.stringify({
        query,
        include_domains: ['linkedin.com'],
        time_range: 'week',
        max_results: 20,
        search_depth: 'basic',
      }),
    });
    if (!Array.isArray(data.results) || data.results.length > 20)
      throw new Error('Tavily response invalid');

    return data.results
      .filter((r) => {
        try {
          if (!r.url) return false;
          const url = new URL(r.url);
          const host = url.hostname;
          return url.protocol === 'https:' && !url.username && !url.password
            && (host === 'linkedin.com' || host.endsWith('.linkedin.com'));
        } catch {
          return false;
        }
      })
      .map((r) => {
        const { author, title } = parseTitle(r.title ?? '');
        const pub = r.published_date ? new Date(r.published_date) : null;
        return {
          source: 'linkedin_web',
          externalId: r.url!,
          url: r.url!,
          title: truncate(title, 300),
          content: truncate(r.content ?? title, 800),
          author,
          authorHandle: author,
          community: r.url!.includes('/pulse/') ? 'article' : 'post',
          publishedAt: pub && !Number.isNaN(pub.getTime()) ? pub : new Date(),
        } satisfies RawMention;
      })
      .filter((m) => m.content);
  },
};
