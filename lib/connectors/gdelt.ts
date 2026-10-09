import { booleanQuery, type Connector, type ListeningQuery, type RawMention } from './types';
import { truncate } from './util';

export const GDELT_RATE_LIMITED = 'Rate limited by GDELT, will retry on the next refresh';

export function gdeltQuery(q: ListeningQuery): string {
  const anyTerms = q.anyTerms.slice(0, 6);
  // GDELT only permits parentheses around OR groups, never a single anchor.
  return booleanQuery(anyTerms.length === 1
    ? { ...q, anyTerms: [], allTerms: [anyTerms[0], ...q.allTerms] }
    : { ...q, anyTerms });
}

/** Retry only 429, respecting Retry-After and a 45-second total collector budget. */
export async function fetchGdeltJson<T>(url: string, send: typeof fetch = fetch,
  now = Date.now, pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))): Promise<T> {
  const deadline = now() + 45_000;
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error(GDELT_RATE_LIMITED);
    const response = await send(url, { headers: { Accept: 'application/json', 'User-Agent': 'SocialRadar/1.0' },
      signal: AbortSignal.timeout(Math.min(15_000, remaining)), cache: 'no-store' });
    if (response.ok) return await response.json() as T;
    // Release the body before waiting; never retry malformed queries or server errors.
    await response.body?.cancel();
    if (response.status !== 429) throw new Error(`HTTP ${response.status} from GDELT`);
    const retryAfter = response.headers.get('retry-after');
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000
      : retryAfter ? Date.parse(retryAfter) - now() : NaN;
    const wait = Math.max(5_000, Number.isFinite(delay) ? delay : [7_000, 12_000][attempt] ?? 12_000);
    if (attempt === 2 || wait >= deadline - now()) throw new Error(GDELT_RATE_LIMITED);
    await pause(wait);
  }
  throw new Error(GDELT_RATE_LIMITED);
}

// GDELT usa nomi di lingua per esteso; mappa dei più comuni verso ISO 639-1.
const LANG_MAP: Record<string, string> = {
  italian: 'it', english: 'en', spanish: 'es', french: 'fr', german: 'de',
  portuguese: 'pt', dutch: 'nl', polish: 'pl', russian: 'ru', arabic: 'ar',
  chinese: 'zh', japanese: 'ja', korean: 'ko', turkish: 'tr', romanian: 'ro',
  hungarian: 'hu', czech: 'cs', greek: 'el', swedish: 'sv', danish: 'da',
  finnish: 'fi', norwegian: 'no', ukrainian: 'uk', hebrew: 'he', hindi: 'hi',
  indonesian: 'id', vietnamese: 'vi', thai: 'th', slovak: 'sk', bulgarian: 'bg',
  croatian: 'hr', serbian: 'sr', catalan: 'ca', slovenian: 'sl',
};

// GDELT filtra per paese con codici FIPS, che differiscono dall'ISO per alcuni stati.
const FIPS: Record<string, string> = {
  IT: 'IT', US: 'US', GB: 'UK', FR: 'FR', DE: 'GM', ES: 'SP', BR: 'BR',
  MX: 'MX', CA: 'CA', AU: 'AS', IN: 'IN', NL: 'NL', PL: 'PL', JP: 'JA',
};

type GdeltArticle = {
  url: string; title: string; seendate: string; domain: string;
  language: string; sourcecountry: string;
};

function parseSeenDate(s: string): Date {
  // Formato: 20260701T063000Z
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return new Date();
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

export const gdelt: Connector = {
  id: 'gdelt',
  label: 'GDELT (worldwide news)',
  tier: 'free',
  enabled: () => true,
  async fetchMentions(q) {
    let query = gdeltQuery(q);
    if (!query) return [];
    const countries = q.countries.map((c) => FIPS[c]).filter(Boolean);
    if (countries.length === 1) query += ` sourcecountry:${countries[0]}`;
    else if (countries.length > 1) query += ` (${countries.map((c) => `sourcecountry:${c}`).join(' OR ')})`;
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=75&sort=datedesc&timespan=3d`;
    const data = await fetchGdeltJson<{ articles?: GdeltArticle[] }>(url);
    return (data?.articles ?? []).map((a) => ({
      source: 'gdelt',
      externalId: a.url,
      url: a.url,
      title: truncate(a.title ?? '', 300),
      content: truncate(a.title ?? '', 300),
      // GDELT dice da che paese viene la testata: è l'unica fonte che lo
      // dichiara, e finora lo stavamo buttando via.
      country: a.sourcecountry,
      author: a.domain,
      community: a.domain,
      publishedAt: parseSeenDate(a.seendate),
      // Lingue non mappate: lasciamo vuoto, ci penserà l'analisi Claude
      language: LANG_MAP[a.language?.toLowerCase()],
    } satisfies RawMention)).filter((m) => m.title);
  },
};
