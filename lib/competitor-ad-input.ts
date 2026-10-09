import { cleanStoredText } from './text-clean';

export type AdObservationInput = { benchmarkId: number; domain: string; checkedDate: string; platform: 'meta' | 'google';
  adCount: number | null; messageOffer: string; landingUrl: string | null; note: string };
export function adPublicUrl(value: string): string {
  if (value.length > 1800 || /[\s\x00-\x1f\x7f]/.test(value)) throw Error('Use a public HTTPS URL up to 1800 characters.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname) || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':'))
    throw Error('Use a public HTTPS hostname without credentials or a port.');
  return url.href;
}
export function adBrandDomain(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 253 || !/^[a-z0-9.-]+$/i.test(value)) throw Error('Enter the public brand domain, for example example.com.');
  const host = new URL(adPublicUrl(`https://${value}/`)).hostname.replace(/^www\./, '');
  if (host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw Error('Enter a valid public brand domain.');
  return host;
}
export function adLibraryLinks(name: string, domain: string | null) {
  const meta = new URL('https://www.facebook.com/ads/library/');
  for (const [key, value] of Object.entries({ active_status: 'all', ad_type: 'all', country: 'ZA', search_type: 'keyword_unordered', q: cleanStoredText(name, 120) })) meta.searchParams.set(key, value);
  const google = new URL('https://adstransparency.google.com/'); google.searchParams.set('region', 'ZA');
  if (domain) google.searchParams.set('domain', adBrandDomain(domain));
  return { meta: meta.href, google: google.href };
}
export const adToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function parseAdObservation(body: Record<string, unknown>, today = adToday()): AdObservationInput {
  if (!Number.isSafeInteger(body.benchmarkId) || Number(body.benchmarkId) < 1) throw Error('Choose a benchmark brand in this project.');
  const date = body.checkedDate;
  if (typeof date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(date) || !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date || date < '2000-01-01' || date > today) throw Error('Enter a real date checked, from 2000 through today in SAST.');
  if (body.platform !== 'meta' && body.platform !== 'google') throw Error('Choose Meta or Google.');
  if (body.adCount !== null && (!Number.isSafeInteger(body.adCount) || Number(body.adCount) < 0 || Number(body.adCount) > 1_000_000))
    throw Error('Enter a whole ad count from 0 to 1000000, or leave it unknown.');
  const bounded = (value: unknown, label: string) => {
    if (typeof value !== 'string') throw Error(`Enter ${label}.`);
    const result = cleanStoredText(value).trim();
    if (Array.from(result).length > 400) throw Error(`Keep ${label} within 400 characters.`);
    return result;
  };
  const messageOffer = bounded(body.messageOffer, 'the message or offer'), note = bounded(body.note, 'a note');
  if (!messageOffer && !note) throw Error('Describe what you saw in the message or note.');
  if (typeof body.landingUrl !== 'string') throw Error('Use a public HTTPS landing page or leave it blank.');
  return { benchmarkId: Number(body.benchmarkId), domain: adBrandDomain(body.domain), checkedDate: date, platform: body.platform,
    adCount: body.adCount as number | null, messageOffer, note, landingUrl: body.landingUrl.trim() ? adPublicUrl(body.landingUrl.trim()) : null };
}
