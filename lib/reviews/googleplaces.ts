import { cfg, sourceAllowed } from '@/lib/connector-config';
import { fetchBoundedProviderJson } from '@/lib/public-http';
import type { RawReview } from './types';

// Google Places API (Legacy Place Details): fields=reviews. Richiede una
// chiave gratuita (livello free-tier con fatturazione attivata) — GOOGLE_PLACES_API_KEY.
//
// ATTENZIONE — a differenza del connettore App Store, questo NON è stato
// verificato dal vivo: non c'è una chiave disponibile in questo ambiente per
// testarlo. È scritto secondo la documentazione ufficiale di Google, stabile
// da anni, ma va considerato "da confermare al primo utilizzo reale" — lo
// stesso principio per cui non si è indovinata l'API di engagement LinkedIn.
//
// Due limiti reali dell'endpoint, non evitabili: restituisce al massimo 5
// recensioni per luogo (le "più rilevanti", non necessariamente le più
// recenti), e non fornisce un id stabile per recensione — se ne costruisce
// uno da autore+timestamp, con margine di collisione trascurabile.
type PlaceReview = {
  author_name?: string;
  rating?: number;
  text?: string;
  time?: number;          // unix seconds
  relative_time_description?: string;
};
type PlaceDetailsResponse = {
  status: string;
  result?: { name?: string; reviews?: PlaceReview[] };
};

export function googlePlacesEnabled(): boolean {
  // Billing eligibility is not approved; OPS does not expose this approval yet.
  return process.env.RADAR_GOOGLE_PLACES_BILLING_APPROVED === '1'
    && sourceAllowed('googleplaces', 'freekey') && Boolean(cfg('GOOGLE_PLACES_API_KEY'));
}

export async function fetchGooglePlacesReviews(placeId: string): Promise<RawReview[]> {
  const key = googlePlacesEnabled() ? cfg('GOOGLE_PLACES_API_KEY') : undefined;
  if (!key) return [];
  const url = `https://maps.googleapis.com/maps/api/place/details/json`
    + `?place_id=${encodeURIComponent(placeId)}&fields=name,reviews&key=${key}`;

  const data = await fetchBoundedProviderJson<PlaceDetailsResponse>(url, {
    hostname: 'maps.googleapis.com', maxBytes: 256_000, timeoutMs: 12_000,
  });
  if (data.status !== 'OK') throw new Error('Google Places response unavailable');
  const reviews = data.result?.reviews ?? [];

  return reviews
    .filter((r): r is PlaceReview & { rating: number } => typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5)
    .map((r) => {
      const time = r.time ?? Math.floor(Date.now() / 1000);
      return {
        externalId: `${time}-${(r.author_name ?? 'anon').slice(0, 40)}`,
        rating: Math.round(r.rating),
        content: r.text ?? '',
        author: r.author_name,
        publishedAt: new Date(time * 1000),
      } satisfies RawReview;
    });
}
