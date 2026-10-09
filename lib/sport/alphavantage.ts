import { cfg, sourceAllowed } from '@/lib/connector-config';
import { fetchBoundedProviderJson } from '@/lib/public-http';

// Alpha Vantage TIME_SERIES_DAILY: chiusure giornaliere per un ticker (formato
// tipo JUVE.MI per Milano, MANU per il Nasdaq, BVB.DE per Francoforte).
// Gratis, chiave via email in 20 secondi — non registrata in autonomia qui.
//
// Verificato dal vivo SOLO che l'endpoint GLOBAL_QUOTE risponde e che la
// chiave demo pubblica funziona esclusivamente su IBM (rifiuta ogni altro
// simbolo con un messaggio "Information", non un errore HTTP — quel
// pattern di risposta "200 OK ma senza i dati attesi" è verificato dal
// vivo ed è gestito qui sotto). La forma esatta di TIME_SERIES_DAILY segue
// la stessa convenzione di chiavi numerate osservata dal vivo su
// GLOBAL_QUOTE, ma non è stata provata su un ticker europeo reale: stesso
// principio di onestà già applicato a football-data.org.
//
// Quota gratuita dichiarata: 25 richieste/GIORNO, condivisa fra tutti i
// progetti che usano questa chiave — per questo il richiamo "al massimo
// una volta al giorno per ticker" vive nel chiamante (lib/sport/index.ts),
// non qui: questo file si limita a fare la chiamata quando richiesto.

export type DailyClose = { date: string; close: number; changePct: number | null };

export function alphaVantageEnabled(): boolean {
  return sourceAllowed('alphavantage', 'freekey') && Boolean(cfg('ALPHA_VANTAGE_API_KEY'));
}

export async function fetchDailyCloses(ticker: string): Promise<DailyClose[]> {
  const key = alphaVantageEnabled() ? cfg('ALPHA_VANTAGE_API_KEY') : undefined;
  if (!key) return [];
  const params = new URLSearchParams({
    function: 'TIME_SERIES_DAILY', symbol: ticker, outputsize: 'compact', apikey: key,
  });
  const data = await fetchBoundedProviderJson<Record<string, unknown>>(`https://www.alphavantage.co/query?${params}`, {
    hostname: 'www.alphavantage.co', maxBytes: 256_000, timeoutMs: 12_000,
  });

  const series = data['Time Series (Daily)'] as Record<string, { '4. close'?: string }> | undefined;
  if (!series) throw new Error('Alpha Vantage data unavailable'); // 200/Information is not a successful quote

  const rows = Object.entries(series)
    .map(([date, v]) => ({ date, close: Number(v['4. close']) }))
    .filter((r) => Number.isFinite(r.close))
    .sort((a, b) => a.date.localeCompare(b.date)); // dal più vecchio, per calcolare la variazione in ordine

  let prev: number | null = null;
  return rows.map((r) => {
    const changePct = prev !== null && prev > 0 ? Math.round(((r.close - prev) / prev) * 10000) / 100 : null;
    prev = r.close;
    return { date: r.date, close: r.close, changePct };
  });
}
