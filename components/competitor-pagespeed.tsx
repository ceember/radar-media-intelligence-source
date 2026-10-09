import type { CompetitorPage } from '@/lib/competitor-page';
import { PAGESPEED_CATEGORIES, type PageSpeedAudit, type PageSpeedProvider } from '@/lib/competitor-pagespeed';
import { PageSpeedControls } from './pagespeed-controls';

const stamp = (date: string) => new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date)) + ' SAST';
const labels = { performance: 'Performance', accessibility: 'Accessibility', 'best-practices': 'Best Practices', seo: 'SEO' };
export function CompetitorPageSpeed({ projectId, pages, audits, canWrite, ownServer = false }: { projectId: number; pages: CompetitorPage[]; audits: PageSpeedAudit[]; canWrite: boolean; ownServer?: boolean }) {
  const providers: PageSpeedProvider[] = ownServer || audits.some(a => a.provider === 'f9') ? ['google','f9'] : ['google'];
  return <section className="min-w-0 space-y-4"><h2 className="text-xl font-semibold text-slate-100">Speed And SEO Lab Comparison</h2>
    <p className="text-sm text-slate-400">Hosted PageSpeed Insights tests one selected URL and mobile or desktop strategy. Ten attempts per project each UTC day; failures count. Successful audits are cached for 24 hours. Results describe a dated Lighthouse lab test and vary with test conditions. Real-user field data is not measured here. Anonymous capacity may be unavailable; requests are never automatically retried.</p>
    {providers.includes('f9') && <p className="text-sm text-slate-400">Own-server lab audits share the ten-attempt daily cap. Providers and strategies have separate cached results. Own-server records show when the gateway response was recorded; the gateway does not supply an audit timestamp, final URL or runner version.</p>}
    {!canWrite && <p className="text-sm text-slate-400">Shared lab history is read-only. Only the project owner or an admin can request an audit.</p>}
    {!pages.length && <p className="text-sm text-slate-400">Select public pages above to compare lab evidence.</p>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">{pages.map(page => <article key={page.id} className="min-w-0 space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="break-words font-semibold text-slate-100">{page.entity} · {page.label}</h3>
      <a href={page.url} target="_blank" rel="noopener noreferrer" className="block break-all text-xs text-sky-300 underline">{page.url}</a>
      {canWrite && <PageSpeedControls projectId={projectId} pageId={page.id} ownServer={ownServer} />}
      {providers.flatMap(provider => (['mobile', 'desktop'] as const).map(strategy => {
        const audit = audits.find(a => a.pageId === page.id && a.sourceUrl === page.url && a.strategy === strategy && (a.provider ?? 'google') === provider), result = audit?.status === 'ok' ? audit.result : null;
        return <div key={`${provider}-${strategy}`} className="min-w-0 space-y-2 border-t border-white/10 pt-3">
          <h4 className="text-sm font-medium capitalize text-slate-200">{strategy} Lab · {provider === 'f9' ? 'Own Server' : 'Google PageSpeed'}</h4>
          {provider === 'f9' && <p className="text-xs text-slate-400">Lab audit, own server</p>}
          {!audit ? <p className="text-xs text-slate-400">No audit recorded.</p> : result ? <>
            <p className="text-xs text-slate-400">{provider === 'f9' ? 'Recorded' : 'Measured'} {stamp(result.measuredAt)}{provider === 'google' ? ` · Lighthouse ${result.version || 'version unknown'}` : ''}</p>
            <dl className="grid grid-cols-2 gap-2 text-xs">{PAGESPEED_CATEGORIES.map(id => <div key={id} className="rounded bg-white/5 p-2"><dt className="text-slate-400">{labels[id]}</dt><dd className="mt-1 text-base text-slate-100">{result.scores[id] === null ? 'Unknown' : `${result.scores[id]} / 100`}</dd></div>)}</dl>
            <p className="text-xs text-slate-300">LCP: {result.lcpMs === null ? 'Unknown' : `${(result.lcpMs / 1000).toFixed(2)} s`} · CLS: {result.cls === null ? 'Unknown' : result.cls.toFixed(3)} · TBT: {result.tbtMs === null ? 'Unknown' : `${Math.round(result.tbtMs)} ms`}</p>
            {result.finalUrl && result.finalUrl !== page.url && <a className="block break-all text-xs text-sky-300 underline" href={result.finalUrl} target="_blank" rel="noopener noreferrer">Audited Final URL: {result.finalUrl}</a>}
            {result.warnings.map((w, i) => <p key={i} className="break-words text-xs text-amber-300">{w}</p>)}
            {result.diagnostics.length > 0 && <details className="text-xs text-slate-400"><summary>Selected Lab Diagnostics</summary><ul className="mt-2 space-y-2">{result.diagnostics.map(d => <li className="break-words" key={d.id}>{d.title}{d.display ? ` · ${d.display}` : ''}{d.score === null ? ' · score unknown' : ` · ${d.score}/100`}</li>)}</ul></details>}
          </> : <p className="break-words text-xs text-amber-300">{stamp(audit.checkedAt)} · Unknown · {audit.message}</p>}
        </div>;
      }))}
    </article>)}</div>
  </section>;
}
