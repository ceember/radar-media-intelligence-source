'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatArticleChecked } from '@/lib/sidebar-date';
import type { NewsjackMode, NewsjackProfile, NewsjackSavedRun } from '@/lib/newsjack-types';
import {neutralNewsjackText} from '@/lib/newsjack-labels';
import {PLANNING_TITLES,type PlanningRun} from '@/lib/newsjack-planning-types';

const inputClass='w-full rounded-lg border border-[var(--border)] bg-black/10 p-3 text-sm outline-none focus:border-sky-500 disabled:opacity-60';
const buttonClass='rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50';
const lines=(s:string)=>s.split('\n').map(x=>x.trim()).filter(Boolean);

export function SavedNewsjackResult({run,viewedAt}:{run:NewsjackSavedRun|PlanningRun;viewedAt:string}) {
  const result=run.result;
  return <article className="panel min-w-0 space-y-4 p-5">
    <h2 className="text-lg font-semibold">Saved {run.mode==='opportunities'?'Opportunities':run.mode==='angles'?'Angles And Headlines':run.mode==='review'?'Pitch Review':PLANNING_TITLES[run.mode]}</h2>
    <p className="text-xs text-slate-400">{formatArticleChecked(run.createdAt)} · {run.status}</p>
    {result&&<p className="text-sm text-amber-300">A person must confirm before sending</p>}
    {result?.outcome==='insufficient-facts'&&<p role="status" className="text-sm text-amber-300">Not enough sourced facts to write angles</p>}
    {run.error&&<p role="alert" className="text-sm text-red-300">{run.error}</p>}
    {result?.opportunities.map(story=>{const expired=Boolean(story.firstLocatedAt&&Date.parse(viewedAt)-Date.parse(story.firstLocatedAt)>24*3_600_000);return <div key={story.id} className="space-y-2 rounded-lg border border-[var(--border)] p-4">
      <h3 className="break-words font-medium"><a href={story.url} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">{story.title}</a></h3>
      <p className="text-xs text-slate-400">{story.source} · Published {formatArticleChecked(story.publishedAt)}</p>
      <p className="text-sm font-medium">{expired?'Watch — Saved Window Expired':story.route} · {expired?'Stale — Recheck Before Pitching':story.freshness}</p>
      <p className="break-words text-sm text-slate-300">Standing: {story.standing || 'No standing established.'}</p>
      <p className="text-sm text-slate-400">{story.reason}</p>
      {story.originUrl?<p className="text-xs"><a href={story.originUrl} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline">Earliest Located Source</a> · {formatArticleChecked(story.firstLocatedAt!)}. Not proof of the first-ever report.</p>:<p className="text-xs text-amber-300">Who broke it: unconfirmed. A feed date does not establish origin.</p>}
      <Link href={`/newsjack/angles?run=${run.id}&story=${story.id}`} className="inline-block text-sm text-sky-300 underline">Explore Angles</Link>
    </div>})}
    {result?.blocks.map((block,i)=><section key={i} className="min-w-0 space-y-2 border-t border-[var(--border)] pt-4">
      <h3 className="break-words font-medium">{neutralNewsjackText(block.title)}</h3><p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-300">{neutralNewsjackText(block.text)}</p>
      <p className="text-xs text-slate-400">Evidence: {block.sourceIds.map(id=>`[${id}]`).join(' ')}</p>
    </section>)}
    {result&&(run.mode==='review'||result.claims.length>0)&&<section className="space-y-3"><h3 className="font-medium">Facts And Citations</h3>
      {!result.claims.length&&<p className="text-sm text-amber-300">No checkable claims were found.</p>}
      {result.factCheck==='incomplete'&&<p role="alert" className="text-sm text-amber-300">Incomplete — Some Checkable Sentences Were Not Checked</p>}
      {result.claims.map((claim,i)=><div key={i} className="space-y-1 rounded-lg border border-[var(--border)] p-3 text-sm">
        <p className="break-words font-medium">{i+1}. {claim.claim}</p>
        <p className={claim.status==='supported'?'text-sky-300':'text-amber-300'}>{claim.status==='supported'?'Supported By Source':claim.status==='missing-source'?'Missing Source':claim.status==='contradicted'?'Contradicted By Source':'Stated In Source - Context Needs Review'}</p>
        <p className="break-words text-slate-300">{claim.reason.replace(/\bverif\w*\b/gi,'source check required')}</p>
        {claim.sourceId&&<p className="text-xs text-slate-400">Evidence [{claim.sourceId}]: {claim.evidenceQuote}</p>}
      </div>)}</section>}
    {Boolean(result?.notChecked?.length)&&<section className="space-y-2"><h3 className="font-medium">Not Checked</h3><ul className="space-y-2 text-sm text-amber-300">{result!.notChecked!.map((sentence,i)=><li key={i} className="break-words">{sentence}</li>)}</ul></section>}
    {result&&<section className="space-y-2"><h3 className="font-medium">Warning</h3><ul className="space-y-1 text-xs text-amber-300">{result.warnings.map((warning,i)=><li key={i} className="break-words">{warning==='A person must confirm before sending'?warning:neutralNewsjackText(warning)}</li>)}</ul></section>}
    {Boolean(result?.sources.length)&&<details className="text-xs text-slate-400"><summary className="cursor-pointer">Evidence Snapshots</summary>
      {result!.sources.map(source=><div key={source.id} className="mt-3 min-w-0 space-y-1">
        <p>[{source.id}] {source.url?<a href={source.url} target="_blank" rel="noopener noreferrer" className="break-all text-sky-300 underline">{source.title}</a>:source.title} · {source.read?'Read Snapshot':'Supplied Or Unavailable — Not Source Support'}</p>
        <p>Checked {formatArticleChecked(source.checkedAt)}</p><p className="whitespace-pre-wrap break-words">{source.text||'No usable source text.'}</p>
      </div>)}</details>}
  </article>;
}

export function NewsjackPanel({projectId,mode,profile,canWrite,canRun,history:initialHistory,opportunities,selection,viewedAt:initialViewedAt}:{
  projectId:number;mode:NewsjackMode|'setup';profile:NewsjackProfile;canWrite:boolean;canRun:boolean;
  history:NewsjackSavedRun[];opportunities:NewsjackSavedRun[];selection:string;viewedAt:string;
}) {
  const [viewedAt,setViewedAt]=useState(initialViewedAt);
  const [history,setHistory]=useState(initialHistory),[selected,setSelected]=useState<NewsjackSavedRun|null>(initialHistory[0]??null);
  const [input,setInput]=useState(''),[urls,setUrls]=useState(''),[opportunity,setOpportunity]=useState(()=>opportunities.some(run=>run.result?.opportunities.some(story=>`${run.id}:${story.id}`===selection))?selection:'');
  const [standing,setStanding]=useState(profile.standing),[topics,setTopics]=useState(profile.topics.join('\n')),
    [competitors,setCompetitors]=useState(profile.competitors.join('\n')),[proof,setProof]=useState(profile.proofAssets.map(p=>`${p.url} | ${p.title}`).join('\n')),
    [people,setPeople]=useState(profile.spokespeople.join('\n'));
  const [publicOnly,setPublicOnly]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const picks=opportunities.flatMap(run=>(run.result?.opportunities??[]).map(story=>({value:`${run.id}:${story.id}`,title:`${story.route}: ${story.title}`})));
  async function submit() {
    if(busy||!publicOnly||!canWrite) return;
    setBusy(true);setError('');setMessage('');
    try {
      const profileInput={standing,topics:lines(topics),competitors:lines(competitors),spokespeople:lines(people),
        proofAssets:lines(proof).map(line=>{const [url,...title]=line.split('|');return {url:url.trim(),title:title.join('|').trim()}})};
      const [runId,storyId]=opportunity.split(':').map(Number);
      const res=await fetch('/api/newsjack',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,publicOnly,
        ...(mode==='setup'?{action:'profile',profile:profileInput}:{mode,input,sourceUrls:lines(urls),...(opportunity?{opportunityRunId:runId,opportunityId:storyId}:{})})})});
      const data=await res.json();
      if(data.run){setViewedAt(new Date().toISOString());setSelected(data.run);setHistory(old=>[data.run,...old].slice(0,15));}
      if(!res.ok) throw new Error(data.error||'Newsjack is unavailable.');
      if(data.run){setMessage('Saved To This Project. Draft For Human Review.');}
      else setMessage('Monitor Profile Saved. These Pages Use It On Your Next Run.');
    } catch(e){setError(e instanceof Error?e.message:'Newsjack is unavailable.');} finally{setBusy(false);}
  }
  return <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
    <div className="min-w-0 space-y-4">
      <p className="text-sm text-slate-400">Drafts For Human Review · No Outreach Is Sent · No Invented Facts Or Quotes · Tragedy Is Not A Promotional Hook</p>
      {mode!=='setup'&&<p className="text-xs text-slate-400">30 AI calls per day across Newsjack · Pitch Review reserves two calls · Resets at 00:00 UTC · The existing AI spend cap also applies</p>}
      {!canWrite&&<p className="text-sm text-amber-300">Read-only project. Saved results and profile remain available; only the owner or an admin can make changes.</p>}
      <form className="panel min-w-0 space-y-4 p-5" onSubmit={e=>{e.preventDefault();void submit()}}>
        {mode==='setup'?<>
          <label className="block space-y-1 text-sm">Standing<textarea aria-label="Standing" rows={3} maxLength={1600} className={inputClass} disabled={!canWrite||busy} value={standing} onChange={e=>{setStanding(e.target.value);setPublicOnly(false)}} placeholder="What earns this brand a right to comment? Public expertise or operational experience."/></label>
          {([['Beat Topics',topics,setTopics,1200],['Competitors',competitors,setCompetitors,1200],['Public Proof Assets',proof,setProof,11000],['Spokespeople',people,setPeople,800]] as const).map(([label,value,setter,max])=><label key={label} className="block space-y-1 text-sm">{label}<textarea aria-label={label} className={inputClass} rows={3} maxLength={max} disabled={!canWrite||busy} value={value} onChange={e=>{setter(e.target.value);setPublicOnly(false)}} placeholder={label==='Public Proof Assets'?'One per line: https://public-source.example/story | Asset title':'One per line'}/></label>)}
          <p className="text-xs text-slate-400">Competitors are prefilled from this project’s benchmark entities. Include only public proof and confirmed spokespeople; no private client financial data. This profile configures manual runs; it does not schedule or send alerts.</p>
        </>:<>
          {mode==='opportunities'?<p className="text-sm text-slate-300">Assess up to three recent public news stories after filtering obvious junk, duplicates and unsafe hooks. Origin gaps remain visible; a recent feed timestamp alone cannot make a story pitch-ready. <Link href="/newsjack/setup" className="text-sky-300 underline">Set Up Standing And Proof</Link></p>:<>
            {mode==='angles'&&<label className="block space-y-1 text-sm">Saved Opportunity<select aria-label="Saved Opportunity" className={inputClass} value={opportunity} disabled={!canRun||busy} onChange={e=>setOpportunity(e.target.value)}><option value="">Use My Pasted Update</option>{picks.map(p=><option key={p.value} value={p.value}>{p.title}</option>)}</select></label>}
            <label className="block space-y-1 text-sm">{mode==='angles'?'Public Update And Facts':'Pitch To Review'}<textarea aria-label={mode==='angles'?'Public Update And Facts':'Pitch To Review'} className={inputClass} rows={7} maxLength={8000} required={!opportunity} disabled={!canRun||busy||Boolean(opportunity)} value={input} onChange={e=>{setInput(e.target.value);setPublicOnly(false)}} placeholder="Paste public material. Include the factual basis and dates; unsupported claims remain without source support."/></label>
            <label className="block space-y-1 text-sm">Public Source URLs<textarea aria-label="Public Source URLs" rows={3} maxLength={8100} className={inputClass} disabled={!canRun||busy} value={urls} onChange={e=>{setUrls(e.target.value);setPublicOnly(false)}} placeholder="Up to four public article URLs, one per line. Only successfully read snapshots can support a fact check."/></label>
          </>}
        </>}
        {canWrite&&<label className="flex items-start gap-2 text-sm text-slate-300"><input type="checkbox" checked={publicOnly} disabled={busy} onChange={e=>setPublicOnly(e.target.checked)} className="mt-1"/>I confirm that this material and every proof asset are public and approved for use. No private client data.</label>}
        {canWrite&&<button className={buttonClass} type="submit" disabled={busy||!publicOnly||(mode!=='setup'&&!canRun)}>{busy?'Working…':mode==='setup'?'Save Monitor Profile':mode==='opportunities'?'Find Opportunities':mode==='angles'?'Generate Angles And Headlines':'Review Pitch'}</button>}
        {!canRun&&canWrite&&mode!=='setup'&&<p className="text-sm text-amber-300">AI is not enabled for this account.</p>}
        {message&&<p role="status" className="text-sm text-sky-300">{message}</p>}{error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
      </form>
      {selected&&<SavedNewsjackResult run={selected} viewedAt={viewedAt}/>}
    </div>
    {mode!=='setup'&&<aside className="panel min-w-0 space-y-3 p-4"><h2 className="font-medium">Project History</h2>
      {history.length?history.map(run=><button key={run.id} type="button" disabled={busy} onClick={()=>{setViewedAt(new Date().toISOString());setSelected(run)}} className="block w-full rounded-md p-2 text-left text-sm hover:bg-white/5">
        <span className="block break-words">{run.input.slice(0,90)}</span><span className="text-xs text-slate-500">{formatArticleChecked(run.createdAt)} · {run.status}</span>
      </button>):<p className="text-sm text-slate-500">No saved runs yet.</p>}</aside>}
  </div>;
}
