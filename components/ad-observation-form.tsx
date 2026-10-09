'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { adBrandDomain, adLibraryLinks } from '@/lib/competitor-ad-input';

export function AdLibraryButtons({ name, domain }: { name: string; domain: string | null }) {
  const links = adLibraryLinks(name, domain), style = 'rounded-lg border border-white/10 px-3 py-2 text-xs text-sky-300 hover:bg-white/5';
  return <div className="space-y-2"><div className="flex flex-wrap gap-2">
    <a className={style} href={links.meta} target="_blank" rel="noopener noreferrer">Open Meta Ad Library</a>
    <a className={style} href={links.google} target="_blank" rel="noopener noreferrer">Open Google Ads Transparency Center</a>
  </div><p className="break-words text-xs text-slate-400">Meta search: {name} · Google domain: {domain || 'Unknown; enter the brand domain or search manually in Google.'} · South Africa filter. Confirm the advertiser and date filters.</p></div>;
}
export function AdObservationForm({ projectId, benchmarkId, name, defaultDomain, today }: { projectId: number; benchmarkId: number; name: string; defaultDomain: string | null; today: string }) {
  const [domain, setDomain] = useState(defaultDomain ?? ''), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), router = useRouter();
  let validDomain: string | null = null;
  try { validDomain = adBrandDomain(domain); } catch { /* The public library remains usable without a domain filter. */ }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget, data = new FormData(form), count = String(data.get('adCount') ?? '').trim();
    setBusy(true); setMessage('Saving the observation…');
    try {
      const response = await fetch('/api/competitors/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        projectId, benchmarkId, domain, checkedDate: data.get('checkedDate'), platform: data.get('platform'), adCount: count === '' ? null : Number(count),
        messageOffer: data.get('messageOffer'), landingUrl: data.get('landingUrl'), note: data.get('note'),
      }) });
      const result = await response.json(); setMessage(result.error ?? result.message ?? 'Reload to check the saved log.');
      if (response.ok) { form.reset(); router.refresh(); }
    } catch { setMessage('Save interrupted. Reload the log before submitting again.'); }
    finally { setBusy(false); }
  }
  const field = 'w-full min-w-0 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-200';
  return <div className="space-y-3"><AdLibraryButtons name={name} domain={validDomain} />
    <details><summary className="cursor-pointer text-sm text-slate-200">Record An Observation</summary>
      <form onSubmit={save} className="mt-3 min-w-0 space-y-3"><fieldset disabled={busy} className="min-w-0 space-y-3">
        <label className="block text-xs text-slate-400">Public Brand Domain<input required className={field} name="domain" maxLength={253} placeholder="example.com" value={domain} onChange={e => setDomain(e.target.value)} /></label>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-xs text-slate-400">Date Checked (SAST)<input required type="date" className={field} name="checkedDate" min="2000-01-01" max={today} defaultValue={today} /></label>
          <label className="min-w-0 text-xs text-slate-400">Platform<select className={field} name="platform"><option value="meta">Meta Ad Library</option><option value="google">Google Ads Transparency Center</option></select></label>
        </div>
        <label className="block text-xs text-slate-400">Ad Count Seen (Blank Means Unknown)<input type="number" className={field} name="adCount" min={0} max={1000000} step={1} /></label>
        <label className="block text-xs text-slate-400">Message Or Offer<textarea className={field} name="messageOffer" maxLength={800} rows={2} /></label>
        <label className="block text-xs text-slate-400">Landing Page URL (Optional)<input className={field} name="landingUrl" type="url" maxLength={1800} placeholder="https://brand.example/packages" /></label>
        <label className="block text-xs text-slate-400">Note<textarea className={field} name="note" maxLength={800} rows={2} /></label>
        <p className="text-xs text-slate-400">Message and note: up to 400 characters each. Describe what you saw in at least one. Count only the ads visible in the library and record the filters in your note.</p>
        <button className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50" disabled={busy}>{busy ? 'Saving…' : 'Save Observation'}</button>
      </fieldset></form>
    </details><p role="status" className="break-words text-xs text-slate-400">{message}</p>
  </div>;
}
