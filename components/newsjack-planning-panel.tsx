'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {SavedNewsjackResult} from './newsjack-panel';
import {formatArticleChecked} from '@/lib/sidebar-date';
import {calendarInputLines} from '@/lib/newsjack-calendar-input';
import type {CoverageConfig,PlanningMode,PlanningRun} from '@/lib/newsjack-planning-types';
const inputClass='w-full rounded-lg border border-[var(--border)] bg-black/10 p-3 text-sm outline-none focus:border-sky-500 disabled:opacity-60';
const buttonClass='rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50';
const lines=(value:string)=>value.split('\n').map(line=>line.trim()).filter(Boolean);
const crisisTypes=['product safety','data security','personnel misconduct','financial irregularity','regulatory','product outage','viral social event','executive statement backlash','third-party action','landmine newsjack','other'];
const descriptions:Record<PlanningMode,string>={crisis:'Confirmed public facts only. Complete the legal gate before viewing or making any draft. Templates add no invented incidents, names, apologies or deadlines.',calendar:'A six-month calendar from dated moments and exact public-source quotes you supply. No dates are filled from memory. Native source checks use one AI stance call; prior-year coverage remains a human research step.',coverage:'Track one keyword and its intended meaning against this project’s collected news from the last 14 days. Up to four new articles per manual check. Only newly supported real features create internal Radar alerts; no message is sent.',journalists:'Check a list of one to four named reporters against your pitch and their supplied public bylines. No contacts are collected. One anchor cannot establish a standing beat; matches remain provisional, with one first pick per outlet at most.'};
export function NewsjackPlanningPanel({mode,projectId,projectName,canWrite,canRun,canInspect=false,history:initialHistory,config,viewedAt}:{mode:PlanningMode;projectId:number;projectName:string;canWrite:boolean;canRun:boolean;canInspect?:boolean;history:PlanningRun[];config:CoverageConfig|null;viewedAt:string}){
 const [fields,setFields]=useState<Record<string,string>>({org:projectName,type:'product outage',legalStatus:'no counsel yet',inquiry:'none yet',keyword:config?.keyword??'',meaning:config?.meaning??'',exclusions:config?.exclusions.join('\n')??''});
 const [publicOnly,setPublicOnly]=useState(false),[legalGate,setLegalGate]=useState(false),[namesConsented,setNamesConsented]=useState(false),[postStillLive,setPostStillLive]=useState(false),[noPriorApproach,setNoPriorApproach]=useState(false);
 const [history,setHistory]=useState(initialHistory),[selected,setSelected]=useState<PlanningRun|null>(initialHistory[0]??null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[checkedAt,setCheckedAt]=useState(viewedAt);
 const validUntil=selected?.result?.crisis?.validUntil;
 useEffect(()=>{
  if(mode!=='crisis'||typeof validUntil!=='string'||!validUntil)return;
  const deadline=Date.parse(validUntil);if(!Number.isFinite(deadline))return;
  const timer=setTimeout(()=>setCheckedAt(new Date().toISOString()),Math.max(0,deadline-Date.now()));
  return ()=>clearTimeout(timer);
 },[mode,validUntil]);
 function update(key:string,value:string){setFields(old=>({...old,[key]:value}));setPublicOnly(false);if(mode==='crisis')setLegalGate(false);}
 function field(label:string,key:string,placeholder:string,rows=2,max=1000){return <label className="block space-y-1 text-sm" key={key}>{label}<textarea aria-label={label} className={inputClass} rows={rows} maxLength={max} disabled={!canWrite||busy} value={fields[key]??''} onChange={event=>update(key,event.target.value)} placeholder={placeholder}/></label>}
 function select(label:string,key:string,values:string[]){return <label className="block space-y-1 text-sm">{label}<select aria-label={label} className={inputClass} disabled={!canWrite||busy} value={fields[key]} onChange={event=>update(key,event.target.value)}>{values.map(value=><option key={value} value={value}>{value}</option>)}</select></label>}
 function input(){
  if(mode==='coverage')return {keyword:fields.keyword,meaning:fields.meaning,exclusions:lines(fields.exclusions??'')};
  if(mode==='calendar')return {entries:calendarInputLines(fields.entries??'')};
  if(mode==='journalists')return {pitch:fields.pitch,subject:fields.subject,noPriorApproach,candidates:lines(fields.candidates??'').map(line=>{const [name,outlet,url,...roleQuote]=line.split('|').map(part=>part.trim());return {name,outlet,url,roleQuote:roleQuote.join('|').trim()}})};
  return {...fields,firstKnownAt:fields.firstKnownAt?new Date(fields.firstKnownAt).toISOString():'',facts:lines(fields.facts??''),actions:lines(fields.actions??''),commitments:lines(fields.commitments??''),namesConsented,postStillLive,legalGateAcknowledged:legalGate};
 }
 async function submit(action?:string){
  if(busy||!canWrite||!publicOnly||(mode==='crisis'&&!legalGate))return;
  setBusy(true);setError('');setMessage('');
  try{const res=await fetch('/api/newsjack/planning',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,mode,publicOnly,input:input(),action})}),data=await res.json();
   if(!res.ok)throw Error(data.error??'Newsjack planning is unavailable.');
   if(data.run){setSelected(data.run);setHistory(old=>[data.run,...old].slice(0,15));setCheckedAt(new Date().toISOString());setMessage('Saved To This Project. A Person Must Review Before External Use.');}else setMessage('Keyword And Meaning Saved. Run A Check To Judge New Collected News.');
  }catch(cause){setError(cause instanceof Error?cause.message:'Newsjack planning is unavailable.')}finally{setBusy(false)}
 }
 const stopped=selected?.status==='needs-counsel'&&selected.result?.blocks.length===1&&selected.result.blocks[0].title.startsWith('STOP');
 const expired=mode==='crisis'&&!!selected?.result&&!stopped&&(typeof validUntil!=='string'||!Number.isFinite(Date.parse(validUntil))||Date.parse(validUntil)<=Date.parse(checkedAt));
 return <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_260px]"><div className="min-w-0 space-y-4">
  <p className="text-sm text-slate-400">{descriptions[mode]} <Link href="/newsjack/setup" className="text-sky-300 underline">Monitor Profile</Link></p>
  <p className="text-xs text-slate-400">Drafts For Human Review · No Outreach Is Sent · Public Information Only · 30 AI calls per UTC day across Newsjack and the existing spend cap</p>
  {!canWrite&&<p className="text-sm text-amber-300">Read-only project. You can view saved results; only the owner or an admin can make changes or checks.</p>}
  {mode==='crisis'&&<section className="panel space-y-3 border-amber-500/30 p-5"><h2 className="font-semibold">Legal-Counsel Gate</h2><p className="text-sm text-amber-300">Safety, data, personnel, financial, regulatory or legal exposure needs engaged counsel. Unconsented names and a still-live offending post block drafting. Every permitted draft is for counsel review, never publication clearance.</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={legalGate} onChange={event=>setLegalGate(event.target.checked)}/>I understand the counsel gate and will not use any draft externally before human and legal review.</label></section>}
  {canWrite&&<form className="panel min-w-0 space-y-4 p-5" onSubmit={event=>{event.preventDefault();void submit()}}>
   {mode==='crisis'&&<>
    {select('Incident Type','type',crisisTypes)}{select('Legal Status','legalStatus',['no counsel yet','counsel engaged and reviewing','counsel approved the draft path'])}
    {field('Incident Summary','summary','1–3 plain sentences, no marketing language.',3,600)}
    <label className="block space-y-1 text-sm">First Known At<input aria-label="First Known At" type="datetime-local" className={inputClass} disabled={busy} value={fields.firstKnownAt??''} onChange={event=>update('firstKnownAt',event.target.value)}/></label>
    {field('Organisation','org','Exact organisation name.',1,100)}{field('Your Role','role','Your role in this response.',1,100)}{field('Audience','audience','Press, customers, employees, regulators…',1,150)}
    {field('Confirmed Known Facts','facts','One defensible, complete factual sentence per line. Up to eight.',4,4000)}
    {field('Unknown Or Unconfirmed','unknowns','Explicit gaps; write none if none. These never appear as assertions.',3,1000)}
    {field('Actions Taken','actions','One real completed or current action per line. Up to six.',3,3000)}
    {field('Confirmed Commitments','commitments','Optional: up to three real commitments. Include a timeline only if approved.',2,1500)}
    {field('People Involved','people','Write none, or list only people with consent.',1,300)}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={namesConsented} onChange={event=>{setNamesConsented(event.target.checked);setLegalGate(false)}}/>Every named person has consented to being named.</label>
    {field('Regulatory Exposure','regulatoryExposure','Write none, or the actual known exposure.',2,600)}
    {select('Media Inquiry Timing','inquiry',['none yet','within 24h','within 4h','within 1h','already published'])}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={postStillLive} onChange={event=>{setPostStillLive(event.target.checked);setLegalGate(false)}}/>An offending newsjack post is still live.</label>
   </>}
   {mode==='calendar'&&field('Dated Moments And Sources','entries','One per line: YYYY-MM-DD | Moment title | https://public-source.example/event | Exact source quote. For a range use YYYY-MM-DD..YYYY-MM-DD in the first column. Named quotes: Moment title takes place on 27 November 2026; Moment title runs between 9 November 2026 and 27 November 2026; or runs from START to END, runs from START up to END, runs START to and including END. Both bounds must include their real month, day and year (ISO, D Month YYYY or Month D, YYYY; full month or abbreviation). Bare dates cannot establish the event. Titles must contain no numbers. Missing years, shorthand bounds and unsupported wording are refused. Up to four; both dates inside the next six months, span at most six months. Never rewrite a source to fit.',7,14000)}
   {mode==='journalists'&&<>
    {field('Pitch To Check','pitch','The exact public pitch as written. No placeholders or generic flattery.',5,6000)}
    {field('Exact Topic To Match','subject','Specific topic or problem the supplied anchors must cover.',1,100)}
    {field('Named Reporters And Bylines','candidates','One per line: Name | Outlet | https://publisher.example/byline | Optional exact role quote naming that person as staff, reporter or contributor. Up to four. A current named publisher byline and explicit date are required.',6,11000)}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={noPriorApproach} onChange={event=>setNoPriorApproach(event.target.checked)}/>No team member has already approached these outlets with this story, no live exclusive is outstanding and this is not a CC, batch or parallel-send request.</label>
   </>}
   {mode==='coverage'&&<>{field('Keyword','keyword','Exact brand, product or person to track.',1,100)}{field('What The Keyword Means','meaning','Define the intended entity, industry and context. This controls matching.',3,600)}{field('Exclusions','exclusions','One exclusion per line, up to twelve.',2,1200)}<button type="button" className={buttonClass} disabled={busy||!publicOnly} onClick={()=>void submit('configure')}>Save Keyword And Meaning</button><p className="text-xs text-slate-400">Run uses the saved keyword and meaning. Changed fields take effect after saving. New features appear in <Link href="/alerts" className="text-sky-300 underline">Radar Alerts</Link>.</p></>}
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={publicOnly} onChange={event=>setPublicOnly(event.target.checked)}/>All supplied facts, quotes, bylines and assets are public and approved for use. No private client data.</label>
   <button className={buttonClass} disabled={busy||!publicOnly||(mode==='crisis'?!legalGate:!canRun)||(mode==='journalists'&&!noPriorApproach)}>{busy?'Working…':mode==='crisis'?'Check Gate And Build Holding Draft':mode==='calendar'?'Check Six-Month Calendar':mode==='coverage'?'Check New Collected Coverage':'Check Reporter Fit'}</button>
   {mode!=='crisis'&&!canRun&&<p className="text-sm text-amber-300">AI is not enabled for this account. Saved results remain available.</p>}
  </form>}
  {message&&<p role="status" className="text-sm text-sky-300">{message}</p>}{error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
  {selected&&(mode!=='crisis'||legalGate)&&(expired?<p role="alert" className="panel p-5 text-amber-300">The situation has likely moved. Do not reuse the prior draft. Complete fresh intake and rerun the legal gate.</p>:<SavedNewsjackResult run={selected} viewedAt={checkedAt}/>)}
  {canInspect&&mode==='journalists'&&selected?.result?.reporterDiagnostics&&<details className="panel space-y-3 p-5"><summary className="cursor-pointer font-medium">Admin Reporter Evidence Diagnostics</summary><p className="text-xs text-amber-300">Bounded Sanitized Selections Only — Not Raw Provider Responses Or Proof Of Fit</p>{selected.result.reporterParse&&<p className="text-xs text-slate-400">Parse Status: {selected.result.reporterParse.status} · Expected Source IDs: {selected.result.reporterParse.expectedSourceIds.join(', ')||'None Readable'}</p>}{selected.result.reporterParse?.errors?.map((issue,index)=><p key={index} className="text-xs text-slate-400">Schema Field: {issue.field} · Rule: {issue.rule}</p>)}{selected.result.reporterDiagnostics.map((diagnostic,index)=><div key={index} className="space-y-2 border-t border-[var(--border)] pt-3"><p className="text-xs text-slate-400">Source {diagnostic.sourceId??'Unknown'} · {diagnostic.eligibility}</p><blockquote className="whitespace-pre-wrap break-words text-sm text-slate-300">{diagnostic.quote||'No Valid BODY Sentence Selection'}</blockquote><p className="text-sm text-slate-400">{diagnostic.reason}</p></div>)}</details>}
 </div><aside className="panel min-w-0 space-y-3 p-4"><h2 className="font-medium">Project History</h2>{history.length?history.map(run=><button type="button" key={run.id} disabled={busy} className="block w-full rounded-md p-2 text-left text-sm hover:bg-white/5" onClick={()=>{setSelected(run);setCheckedAt(new Date().toISOString());if(mode==='crisis')setLegalGate(false)}}>{formatArticleChecked(run.createdAt)} · {run.status}</button>):<p className="text-sm text-slate-500">No saved runs yet.</p>}</aside></div>;
}
