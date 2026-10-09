import { redirect } from 'next/navigation';
import { PageHeader, EmptyState } from '@/components/ui';
import { CompetitorControls } from '@/components/competitor-controls';
import { getCurrentUser } from '@/lib/auth';
import { getCurrentProject, getBenchmarkEntities } from '@/lib/data';
import { isDemoMode } from '@/lib/session';
import { researchCanWrite } from '@/lib/web-research';
import { selectedCompetitorPages, competitorCaptureHistory } from '@/lib/competitor-snapshots';
import { competitorDiff } from '@/lib/competitor-page';
import { pageSpeedHistory, pageSpeedGateway } from '@/lib/competitor-pagespeed';
import { CompetitorPageSpeed } from '@/components/competitor-pagespeed';
import { adObservationHistory } from '@/lib/competitor-ads';
import { adToday } from '@/lib/competitor-ad-input';
import { CompetitorAdEvidence } from '@/components/competitor-ad-evidence';
import { CompetitorOffers } from '@/components/competitor-offers';
import { offerReviewHistory } from '@/lib/competitor-offer-reviews';
import { archiveSelection, archiveHistory } from '@/lib/competitor-history';
import { CompetitorArchiveHistory } from '@/components/competitor-archive-history';
import { seoCaptureEvidence } from '@/lib/competitor-seo';
import { CompetitorSeo } from '@/components/competitor-seo';
import { configuredCompetitorSeed } from '@/lib/competitor-seed';
import { technologyCaptureEvidence } from '@/lib/competitor-technologies';
import { CompetitorTechnologies } from '@/components/competitor-technologies';

export const metadata = { title: 'Competitor Intelligence' };
const stamp = (value: string) => new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' SAST';
export default async function CompetitorPage() {
  const user = await getCurrentUser(); if (!user) redirect('/login');
  const project = await getCurrentProject();
  if (!project) return <><PageHeader title="Competitor Intelligence" /><EmptyState message="Create a project to select public competitor pages." /></>;
  const enabled = !isDemoMode() && researchCanWrite(user, project);
  const seed = configuredCompetitorSeed(project);
  const pages = await selectedCompetitorPages(project.id);
  const histories = await Promise.all(pages.map((p) => competitorCaptureHistory(project.id, p.id)));
  const audits = await pageSpeedHistory(project.id);
  const [brands, observations] = await Promise.all([getBenchmarkEntities(project.id), adObservationHistory(project.id)]);
  const reviews = await offerReviewHistory(project.id);
  const [archivePages, archiveLookups] = await Promise.all([archiveSelection(project.id), archiveHistory(project.id)]);
  const seo = await seoCaptureEvidence(project.id, pages);
  const technologies = await technologyCaptureEvidence(project.id, pages);
  return <div className="min-w-0 space-y-6"><PageHeader title="Competitor Intelligence" subtitle={`Public page evidence for “${project.name}”.`} />
    <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-slate-100">Selected Public Pages</h2>
      <p className="text-sm text-slate-400">Up to ten selected pages and thirty capture attempts per project each UTC day. Public static HTML only. Failed attempts count. Robots eligibility is shown for each capture; it does not establish permission under a site’s terms.</p>
      {enabled ? <CompetitorControls projectId={project.id} canSeed={!!seed} seedLabel={seed?.buttonLabel} /> : <p className="text-sm text-slate-400">Shared history is read-only. Only the project owner or an admin can select or capture pages.</p>}
    </section>
    <CompetitorPageSpeed projectId={project.id} pages={pages} audits={audits} canWrite={enabled} ownServer={!!pageSpeedGateway()} />
    <CompetitorAdEvidence projectId={project.id} brands={brands} pages={pages} observations={observations} canWrite={enabled} today={adToday()} />
    <CompetitorArchiveHistory projectId={project.id} pages={pages} selected={archivePages} lookups={archiveLookups} canWrite={enabled}/>
    <CompetitorSeo pages={pages} captures={seo}/>
    <CompetitorTechnologies pages={pages} captures={technologies}/>
    <h2 className="text-xl font-semibold text-slate-100">Competitor Changes</h2>
    {!pages.length && <EmptyState message="Select a public home or package page, then capture it to create a dated baseline." />}
    {pages.map((page, index) => {
      const history = histories[index], current = history[0];
      const previous = history.slice(1).find((s) => s.status === 'ok' && s.sourceUrl === page.url);
      const difference = current ? competitorDiff(previous, current) : null;
      return <section key={page.id} className="min-w-0 space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-6">
        <h3 className="break-words text-lg font-semibold text-slate-100">{page.entity} · {page.label}</h3>
        <a href={page.url} target="_blank" rel="noopener noreferrer" className="block break-all text-sm text-sky-300 underline">{page.url}</a>
        {enabled && <CompetitorControls projectId={project.id} pageId={page.id} />}
        {current ? <><p className="text-sm text-slate-300">{stamp(current.capturedAt)} · {difference?.status === 'baseline' ? 'First Successful Baseline' : difference?.status === 'unchanged' ? 'Unchanged Captured Text' : difference?.status === 'changed' ? 'Captured Text Changed' : difference?.status === 'partial' ? 'Partial Capture — Comparison Unknown' : difference?.status === 'limited' ? 'Comparison Limit Reached — Unknown' : 'Capture Unknown'}</p>
          {current.error && <p className="break-words text-sm text-amber-300">{current.error}</p>}
          {current.evidence && <div className="space-y-1 text-xs text-slate-400">
            <p>Robots: {current.evidence.robots.status} · {current.evidence.robots.userAgent} · checked {stamp(current.evidence.robots.checkedAt)} · crawl delay {current.evidence.robots.delay}s</p>
            {current.evidence.robots.accessCase && <p>Robots access: {current.evidence.robots.accessCase}{current.evidence.robots.httpStatus != null ? ` · HTTP ${current.evidence.robots.httpStatus}` : ''}</p>}
            <p className="break-words">{current.evidence.robots.reason} {current.evidence.robots.rule && `Rule: ${current.evidence.robots.rule}`}</p>
            {current.evidence.robots.sitemaps.length > 0 && <details><summary>Sitemap Evidence (Not Crawled)</summary>{current.evidence.robots.sitemaps.map((s, i) => <p className="break-all" key={i}>{s}</p>)}</details>}
            {current.evidence.method && <p>{current.evidence.method} · input {current.evidence.inputBytes} bytes · stored text {current.evidence.textBytes} bytes{current.evidence.truncated ? ` · truncated at ${(current.evidence.textLimitBytes ?? 20_000) / 1000} KB` : ''}</p>}
          </div>}
          {difference?.status === 'changed' && <><p className="text-xs text-slate-400">Compared with {previous && stamp(previous.capturedAt)}. Only successfully captured static text is compared.</p>
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">{[true, false].map((added) => <div key={String(added)} className={`min-w-0 rounded-lg border p-3 ${added ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}><h4 className="mb-2 text-sm font-medium text-slate-200">{added ? 'Added Text' : 'Removed Text'}</h4>
              <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-slate-300">{difference.changes.filter((c) => added ? c.added : c.removed).map((c) => c.value).join('\n') || 'None'}</pre></div>)}</div>
            {difference.omitted && <p className="text-xs text-amber-300">Only the first 100 changed segments are shown. Inspect the saved captures for the full bounded text.</p>}</>}
          <CompetitorOffers projectId={project.id} current={current} previous={previous} canWrite={enabled} reviews={reviews} />
          <details className="text-sm text-slate-400"><summary>Saved Capture History</summary>{history.map((s) => <div key={s.id} className="my-3 space-y-2 border-t border-white/10 pt-3"><p>{stamp(s.capturedAt)} · {s.status}</p>{s.error && <p>{s.error}</p>}<CompetitorOffers projectId={project.id} current={s} canWrite={false} reviews={reviews} />{s.text !== null && <pre className="whitespace-pre-wrap break-words text-xs leading-6">{s.text}</pre>}</div>)}</details>
        </> : <p className="text-sm text-slate-400">No capture yet.</p>}
      </section>;
    })}
  </div>;
}
