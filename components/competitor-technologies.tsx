import type { CompetitorPage } from '@/lib/competitor-page';
import { TECHNOLOGY_RULESET, type TechnologyCapture } from '@/lib/competitor-technologies';

const stamp = (value: string) => new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' SAST';
export function CompetitorTechnologies({ pages, captures }: { pages: CompetitorPage[]; captures: TechnologyCapture[] }) {
  return <section className="min-w-0 space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-6">
    <h2 className="text-lg font-semibold text-slate-100">Detected From Public Page Evidence</h2>
    <p className="text-sm text-slate-400">Technology markers from up to five saved captures, home pages first. No new requests or scripts are run. Static evidence does not verify active use, the complete stack, backend versions or software spend.</p>
    <p className="text-xs text-slate-500">{TECHNOLOGY_RULESET} · Confidence describes marker specificity, not a measured probability.</p>
    {!captures.length && <p className="text-sm text-slate-400">Select and capture public pages to collect technology evidence.</p>}
    <div className="grid min-w-0 gap-3 lg:grid-cols-2">{captures.map(capture => {
      const page = pages.find(p => p.id === capture.pageId);
      return <div key={capture.pageId} className="min-w-0 space-y-3 rounded-lg border border-white/10 p-3">
        <h3 className="break-words font-medium text-slate-200">{page?.entity} · {page?.label}</h3>
        <a href={capture.sourceUrl} target="_blank" rel="noopener noreferrer" className="block break-all text-xs text-sky-300 underline">{capture.sourceUrl}</a>
        {capture.capturedAt && <p className="text-xs text-slate-500">Captured {stamp(capture.capturedAt)} · Snapshot {capture.snapshotId}</p>}
        <p className="text-xs text-slate-400">{capture.status === 'partial' && 'Partial Evidence · '}{capture.message}</p>
        <ul className="space-y-3">{capture.tags.map(tag => <li key={tag.technology} className="space-y-1">
          <p className="text-sm font-medium text-sky-200">{tag.technology}</p>
          {tag.markers.map((marker, i) => <div key={i} className="text-xs text-slate-400">
            <p>{marker.kind} · {marker.confidence} Confidence{marker.version && ` · Explicit Version Marker ${marker.version}`}</p>
            <p className="break-all font-mono text-[11px]">{marker.value}</p>
          </div>)}
        </li>)}</ul>
      </div>;
    })}</div>
    <p className="text-xs text-slate-500">Adapted GPL-3.0 fingerprints from <a href="https://github.com/enthec/webappanalyzer/tree/eea872af449e207e055398f7369d11ee48c8ea03/src/technologies" target="_blank" rel="noopener noreferrer" className="underline">enthec/webappanalyzer</a>. <a href="https://github.com/ceember/radar-media-intelligence-source" target="_blank" rel="noopener noreferrer" className="underline">Corresponding Source</a>. The page footer links the exact production source revision.</p>
  </section>;
}
