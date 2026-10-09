import type { CompetitorPage } from '@/lib/competitor-page';
import type { ArchiveLookup, ArchiveFailureCategory } from '@/lib/competitor-history';
import { ArchiveControls, ArchiveStatusPoll } from './archive-controls';

const stamp=(value:string)=>new Intl.DateTimeFormat('en-ZA',{timeZone:'Africa/Johannesburg',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' SAST';
const failureLabels:Record<ArchiveFailureCategory,string>={http:'HTTP Response',timeout:'Timeout Or Work Deadline',connection:'Connection Unavailable',dns:'DNS Or Public Address',size:'Metadata Size',encoding:'Response Encoding',parse:'Invalid Metadata',redirect:'Redirect Refused',guard:'Public-Target Guard',interrupted:'Interrupted Lookup',quota:'Daily Attempt Cap',unknown:'Unclassified Failure'};
const duration=(value?:number|null)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?(value/1000).toFixed(2)+' s':'Not Recorded';
export function CompetitorArchiveHistory({projectId,pages,selected,lookups,canWrite}:{projectId:number;pages:CompetitorPage[];selected:number[];lookups:ArchiveLookup[];canWrite:boolean}){
  const running=lookups.filter(lookup=>lookup.status==='running'&&selected.includes(lookup.pageId)&&pages.some(page=>page.id===lookup.pageId&&page.url===lookup.sourceUrl)).map(lookup=>lookup.id);
  return <section className="min-w-0 space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-6">
    <h2 className="text-lg font-semibold text-slate-100">Archived Page History</h2>
    <p className="text-sm text-slate-400">Choose up to five selected public URLs. Internet Archive index metadata only: up to 30 recent HTML snapshots per page, successful index queries cached for 24 hours. Lookups run in the background for up to four minutes. Ten lookup attempts per project each UTC day; failures count. No automatic retry, Save Page Now request or archived content is loaded into Radar.</p>
    <p className="text-xs text-slate-400">Archives can be missing, blocked or incomplete. Links show historical evidence, never today’s price. Opening a replay leaves Radar; the archive may redirect or be unavailable.</p>
    {running.length>0&&<ArchiveStatusPoll projectId={projectId} ids={running}/>}
    {canWrite&&pages.length>0&&<ArchiveControls key={projectId} projectId={projectId} pages={pages} selected={selected}/>}
    {!selected.length&&<p className="text-sm text-slate-400">{canWrite?'Select public pages above, save the selection, then check their archive history.':'No archive pages selected. Only the project owner or an admin can select or request archive evidence.'}</p>}
    <div className="grid min-w-0 gap-3 lg:grid-cols-2">{pages.filter(page=>selected.includes(page.id)).map(page=>{
      const lookup=lookups.find(value=>value.pageId===page.id&&value.sourceUrl===page.url);
      return <div key={page.id} className="min-w-0 space-y-3 rounded-lg border border-white/10 p-3">
        <h3 className="break-words font-medium text-slate-200">{page.entity} · {page.label}</h3>
        <a href={page.url} target="_blank" rel="noopener noreferrer" className="block break-all text-xs text-sky-300 underline">{page.url}</a>
        {canWrite&&<ArchiveControls projectId={projectId} pageId={page.id} running={lookup?.status==='running'}/>}
        {lookup?<><p className="text-xs text-slate-400">{lookup.status==='running'?'Lookup Started':'Index Checked'} {stamp(lookup.checkedAt)} · {lookup.status==='running'?'Checking Archive':lookup.status==='ok'?'Completed Index Query':'Archive History Unknown'}</p><p className="break-words text-xs text-slate-400">{lookup.message}</p>
          {lookup.status!=='running'&&<dl className="grid min-w-0 gap-2 text-xs text-slate-400 sm:grid-cols-2">
            <div className="min-w-0 break-words"><dt>Failure Reason</dt><dd>{lookup.status==='ok'?'None — Completed Index':lookup.failureCategory?failureLabels[lookup.failureCategory]??'Unclassified Failure':'Not Recorded'}{lookup.httpStatusClass&&/^[1-5]xx$/.test(lookup.httpStatusClass)?` · HTTP ${lookup.httpStatusClass}`:''}</dd></div>
            <div className="min-w-0 break-words"><dt>Guarded Fetch Elapsed</dt><dd>{duration(lookup.transportElapsedMs)}</dd></div>
            <div className="min-w-0 break-words"><dt>Background Work Before Final Save</dt><dd>{duration(lookup.elapsedMs)}</dd></div>
          </dl>}
          {lookup.status==='ok'&&lookup.records&&<ul className="space-y-2 text-xs">{lookup.records.map(record=><li key={record.timestamp+'\n'+record.originalUrl} className="space-y-1 border-t border-white/10 pt-2"><a href={record.replayUrl} target="_blank" rel="noopener noreferrer" className="block break-words text-sky-300 underline">Archived {stamp(record.archivedAt)} · Open Historical Page</a><p className="break-all text-slate-500">Original: {record.originalUrl} · {record.mimeType} · HTTP {record.statusCode}</p></li>)}</ul>}</>:<p className="text-xs text-slate-400">Unknown — No Archive Index Checked</p>}
      </div>;
    })}</div>
  </section>;
}
