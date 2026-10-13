import { fetchPublicText } from './public-http';
import { extractArticleHtml, ARTICLE_MAX_BYTES, type ExtractedArticle } from './article-extract';

// ---------------------------------------------------------------------------
// Estrazione del testo di un articolo dalla sua pagina.
//
// Perché serve: i feed danno titolo e sommario, non il pezzo. Su un sommario
// non si distingue "l'articolo parla di te" da "sei citato alla riga 40", il
// sentiment si giudica su un titolo scritto per fare clic, e non si possono
// estrarre citazioni vere. È la differenza fra una rassegna stampa e un elenco
// di link.
//
// Regole di buona educazione, non negoziabili: user-agent che dichiara chi
// siamo, un solo tentativo per pagina, timeout stretto, tetto sulla dimensione
// scaricata e una pausa fra richieste allo stesso sito. Non si rincorre un
// paywall e non si riprova all'infinito.
// ---------------------------------------------------------------------------

const UA = 'Mozilla/5.0 (compatible; RadarBot/1.0; +https://github.com/Scognamiglio1969/radar-intelligence)';
const TIMEOUT_MS = 12_000;
const MAX_BYTES = ARTICLE_MAX_BYTES;      // oltre, è una pagina che non vale la pena leggere

export type ArticleFetch =
  | ({ ok: true; finalUrl: string } & ExtractedArticle)
  | { ok: false; reason: 'opaque_redirect' | 'too_short' | 'unreachable' | 'not_html' };

/**
 * Google News non pubblica l'indirizzo della testata: il link porta a una
 * pagina-guscio che risolve la destinazione via JavaScript, e il codice nel
 * link è un identificatore opaco che solo un'API interna di Google sa
 * sciogliere. Verificato: nel token non c'è alcun URL e nell'HTML nemmeno.
 * Si riconoscono e si saltano — bussare sarebbe traffico sprecato. Per avere
 * il testo pieno di una testata si aggiunge il suo feed RSS al progetto:
 * quei link sono diretti.
 */
export const isOpaqueRedirect = (url: string): boolean => /(^|\/\/)news\.google\./i.test(url);

async function get(url: string, fetchPage: typeof fetchPublicText): Promise<{ html: string; finalUrl: string; contentType: string } | null> {
  try {
    const res = await fetchPage(url, {
      timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    });
    return { html: res.text, finalUrl: res.finalUrl, contentType: res.contentType };
  } catch {
    return null;
  }
}

/** Scarica una pagina e ne estrae il testo. Non solleva mai: riferisce e basta. */
export async function fetchArticleText(url: string, fetchPage = fetchPublicText): Promise<ArticleFetch> {
  if (url.length > 2000) return { ok: false, reason: 'unreachable' };
  // Si riconosce PRIMA di uscire in rete: nessuna richiesta inutile.
  if (isOpaqueRedirect(url)) return { ok: false, reason: 'opaque_redirect' };

  const page = await get(url, fetchPage);
  if (!page) return { ok: false, reason: 'unreachable' };
  if (!page.contentType.toLowerCase().includes('html')) return { ok: false, reason: 'not_html' };
  if (isOpaqueRedirect(page.finalUrl)) return { ok: false, reason: 'opaque_redirect' };

  const article = extractArticleHtml(page.html, page.finalUrl);
  if (!article) return { ok: false, reason: 'too_short' };
  return { ok: true, ...article, finalUrl: page.finalUrl };
}

/**
 * Estrae più articoli senza maltrattare i siti: poche richieste in parallelo e
 * mai due contemporanee allo stesso host. Restituisce solo ciò che è riuscito;
 * i fallimenti li registra chi chiama, per non ritentarli in eterno.
 */
export async function fetchArticles(
  items: { id: number; url: string }[], concurrency = 4,
  fetchArticle = fetchArticleText,
  onResult?: (id: number, result: ArticleFetch) => void,
): Promise<Map<number, ExtractedArticle>> {
  const out = new Map<number, ExtractedArticle>();
  const hostBusy = new Set<string>();
  const queue = [...items];

  const worker = async () => {
    while (queue.length) {
      // Salta i lavori il cui host è già occupato: li riprende il giro dopo.
      const idx = queue.findIndex((it) => {
        try { return !hostBusy.has(new URL(it.url).host); } catch { return false; }
      });
      if (idx === -1) return;
      const [job] = queue.splice(idx, 1);

      let host = '';
      try { host = new URL(job.url).host; } catch { continue; }
      hostBusy.add(host);
      try {
        const r = await fetchArticle(job.url);
        onResult?.(job.id, r);
        if (r.ok) out.set(job.id, { text: r.text, metadata: r.metadata });
      } finally {
        hostBusy.delete(host);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}
