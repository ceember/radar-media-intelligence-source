import type { CompetitorPage } from '@/lib/competitor-page';
import type { SeoCapture } from '@/lib/competitor-seo';

const stamp = (value: string) => new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' SAST';
export function CompetitorSeo({ pages, captures }: { pages: CompetitorPage[]; captures: SeoCapture[] }) {
  return <section className="min-w-0 space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-6">
    <h2 className="text-lg font-semibold text-slate-100">SEO Readiness From Saved Pages</h2>
    <p className="text-sm text-slate-400">Up to five latest saved public captures, home pages first. No new fetch, crawl, AI or paid call. Pass and Fail describe only the named static check, not rankings or actual indexability. Missing browser, header or complete-page evidence stays Unknown.</p>
    {!captures.length && <p className="text-sm text-slate-400">Select and capture public pages to inspect dated SEO evidence.</p>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">{captures.map(capture => {
      const page = pages.find(candidate => candidate.id === capture.pageId);
      return <article key={capture.pageId} className="min-w-0 space-y-3 rounded-lg border border-white/10 p-3">
        <h3 className="break-words font-medium text-slate-200">{page?.entity} · {page?.label}</h3>
        <a href={capture.sourceUrl} target="_blank" rel="noopener noreferrer" className="block break-all text-xs text-sky-300 underline">{capture.sourceUrl}</a>
        {capture.capturedAt && <p className="text-xs text-slate-500">Captured {stamp(capture.capturedAt)} · Snapshot {capture.snapshotId}</p>}
        <p className="text-xs text-slate-400">{capture.message}</p>
        <ul className="space-y-3">{capture.checks.map(check => <li key={check.id} className="space-y-1 text-xs">
          <p className="font-medium text-slate-200">{check.label} · {check.status === 'pass' ? 'Pass' : check.status === 'fail' ? 'Fail' : 'Unknown'}</p>
          <p className="break-words text-slate-400">{check.observed}</p>
        </li>)}</ul>
      </article>;
    })}</div>
    <p className="text-xs text-slate-500">Native deterministic checklist inspired by <a href="https://github.com/AgriciDaniel/claude-seo/tree/4b99de2f7de7e7d5247042e5fb5b4ea9368ef734" target="_blank" rel="noopener noreferrer" className="underline">claude-seo (MIT)</a>. No upstream runtime, installer or subjective SEO score.</p>
  </section>;
}
