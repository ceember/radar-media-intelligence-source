import Link from 'next/link';
import { AdLibraryButtons, AdObservationForm } from './ad-observation-form';
import type { AdObservation } from '@/lib/competitor-ads';
import type { CompetitorPage } from '@/lib/competitor-page';
import { adBrandDomain } from '@/lib/competitor-ad-input';
import { configuredCompetitorAdLibraryNote } from '@/lib/competitor-seed';

export function CompetitorAdEvidence({ projectId, brands, pages, observations, canWrite, today }: {
  projectId: number; brands: { id: number; name: string }[]; pages: CompetitorPage[]; observations: AdObservation[]; canWrite: boolean; today: string;
}) {
  const adLibraryNote = configuredCompetitorAdLibraryNote();
  // Keep the dated ledger visible when a brand is removed from benchmark configuration.
  const visibleBrands = [...brands];
  for (const entry of observations) if (!visibleBrands.some(b => b.id === entry.benchmarkId)) visibleBrands.push({ id: entry.benchmarkId, name: entry.brandName });
  return <section className="min-w-0 space-y-4"><h2 className="text-xl font-semibold text-slate-100">Paid Ads Evidence</h2>
    <p className="text-sm text-slate-400">Open the official public libraries and record what you saw. Radar does not scrape them or collect ad results automatically. These are observations by a person, with the date checked; counts depend on the advertiser and filters selected. They do not establish spend, reach or market share.</p>
    {adLibraryNote && <p className="text-sm text-slate-400">{adLibraryNote}</p>}
    {!canWrite && <p className="text-sm text-slate-400">Shared evidence is read-only. Only the project owner or an admin can record observations.</p>}
    {!brands.length && <p className="text-sm text-slate-400">Add benchmark brands in <Link className="text-sky-300 underline" href="/settings">Projects</Link> to compare paid ads evidence.</p>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">{visibleBrands.map(brand => {
      const current = brands.some(b => b.id === brand.id);
      const history = observations.filter(o => o.benchmarkId === brand.id), selected = pages.find(p => p.entity.trim().toLowerCase() === brand.name.trim().toLowerCase());
      let domain: string | null = null;
      try { domain = adBrandDomain(history[0]?.domain ?? (selected ? new URL(selected.url).hostname : '')); } catch { /* Unknown remains visible. */ }
      return <article key={brand.id} className="min-w-0 space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <h3 className="break-words font-semibold text-slate-100">{brand.name}</h3>
        {!current && <p className="text-xs text-slate-400">Historical evidence; this brand is no longer in the benchmark selection.</p>}
        {canWrite && current ? <AdObservationForm projectId={projectId} benchmarkId={brand.id} name={brand.name} defaultDomain={domain} today={today} /> : <AdLibraryButtons name={brand.name} domain={domain} />}
        <p className="text-xs text-slate-400">Latest 20 observations for this brand, ordered by date checked.</p>
        {!history.length && <p className="text-sm text-slate-400">No observations recorded. Ad count unknown.</p>}
        {history.map(o => <div key={o.id} className="min-w-0 space-y-2 border-t border-white/10 pt-3 text-xs">
          <p className="font-medium text-slate-200">Observed by a person · {o.checkedDate} SAST · {o.platform === 'meta' ? 'Meta Ad Library' : 'Google Ads Transparency Center'}</p>
          <p className="text-slate-400">Ad count seen: {o.adCount === null ? 'Unknown' : o.adCount}</p>
          <p className="break-words text-slate-400">Brand at check: {o.brandName} · {o.domain}</p>
          {o.messageOffer && <p className="whitespace-pre-wrap break-words text-slate-300">Message Or Offer: {o.messageOffer}</p>}
          {o.landingUrl && <a className="block break-all text-sky-300 underline" href={o.landingUrl} target="_blank" rel="noopener noreferrer">Landing Page: {o.landingUrl}</a>}
          {o.note && <p className="whitespace-pre-wrap break-words text-slate-400">Note: {o.note}</p>}
        </div>)}
      </article>;
    })}</div>
  </section>;
}
