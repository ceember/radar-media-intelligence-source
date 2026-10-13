'use client';
import {useState} from 'react';
import Link from 'next/link';
import {formatArticleChecked} from '@/lib/sidebar-date';
import type {VisibilityRun} from '@/lib/newsjack-visibility-types';
import {normalizeVisibilityFailureClass} from '@/lib/newsjack-visibility-diagnostics';

const inputClass='w-full rounded-lg border border-[var(--border)] bg-black/10 p-3 text-sm outline-none focus:border-sky-500 disabled:opacity-60';
const buttonClass='rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50';
const lines=(value:string)=>value.split('\n').map(line=>line.trim()).filter(Boolean);
export function SavedVisibility({run,administrator=false}:{run:VisibilityRun;administrator?:boolean}){
 const result=run.result;
 return <article className="panel min-w-0 space-y-4 p-5"><h2 className="text-lg font-semibold">Saved Writing Audit</h2><p className="text-xs text-slate-400">{formatArticleChecked(run.createdAt)} · {run.status}</p>
  {run.error&&<p role="alert" className="text-sm text-red-300">{run.error}</p>}
  {administrator&&normalizeVisibilityFailureClass(run.failureClass)&&<p className="text-xs text-slate-400">Admin Failure Class: {run.failureClass}</p>}
  {result&&<>
   <section className="space-y-2"><h3 className="font-medium">Verdict And Limits</h3><p className="text-sm text-slate-300">{result.verdict}</p><p className="text-xs text-slate-400">Audience: {result.context.audience} · Publisher: {result.context.publisher} · Purpose: {result.context.purpose}</p><p className="text-xs text-slate-400">Reader Questions: {result.context.queries.join(' · ')||'Not Supplied; No Queries Were Invented'}</p></section>
   <section className="space-y-3"><h3 className="font-medium">Highest-Leverage Changes</h3>{!result.changes.length&&<p className="text-sm text-amber-300">No Applicable Change Was Selected. This Is Not Proof Of Readiness Or Visibility.</p>}
    {result.changes.map(change=><div key={change.lever} className="min-w-0 space-y-2 rounded-lg border border-[var(--border)] p-4"><h4 className="font-medium">{change.title}</h4><blockquote className="whitespace-pre-wrap break-words text-sm text-slate-400">{change.passage}</blockquote><p className="text-sm text-slate-300">{change.action}</p><dl className="space-y-2 text-xs text-slate-400"><div><dt className="font-medium">Why</dt><dd>{change.why}</dd></div><div><dt className="font-medium">Confidence In The Recommendation, Not A Visibility Prediction</dt><dd>{change.confidence}</dd></div><div><dt className="font-medium">Tradeoff</dt><dd>{change.tradeoff}</dd></div></dl></div>)}
   </section>
   <section className="space-y-2"><h3 className="font-medium">Blocking Questions</h3>{result.questions.length?<ul className="space-y-2 text-sm text-amber-300">{result.questions.map(question=><li key={question}>{question}</li>)}</ul>:<p className="text-sm text-slate-400">None Selected; This Does Not Establish Factual Accuracy.</p>}</section>
   <section className="space-y-2"><h3 className="font-medium">Selected Passages Needing Fact Check</h3><p className="text-xs text-amber-300">No Independent Fact Check Was Performed. This Is Not A Complete Claim Inventory. <Link href="/newsjack/review" className="text-sky-300 underline">Pitch Review</Link> provides a separate source-check workflow.</p>{result.claimsToCheck.map(claim=><p key={claim} className="whitespace-pre-wrap break-words text-sm text-slate-300">{claim}</p>)}</section>
   <section className="space-y-2"><h3 className="font-medium">Fact-Preservation Note</h3><p className="text-sm text-slate-300">No Revision Was Made. The Full Supplied Copy Is Retained With Its Numbers, Dates, Names, Quotations, Attribution, Qualifications And Relationships.</p><details className="text-xs text-slate-400"><summary className="cursor-pointer">Original Copy And Fact Ceiling</summary><pre className="mt-3 whitespace-pre-wrap break-words font-sans">{result.ledger.originalCopy}</pre><p className="mt-2 break-all">SHA-256: {result.ledger.sha256}</p></details></section>
   <section className="space-y-2"><h3 className="font-medium">Supplied Evidence Declarations</h3><p className="text-xs text-amber-300">These Links Were Not Retrieved Or Verified. They Do Not Establish Source Support.</p>{result.ledger.evidence.map((source,index)=><div key={index} className="min-w-0 space-y-1 text-sm"><a href={source.url} target="_blank" rel="noopener noreferrer" className="break-all text-sky-300 underline">{source.url}</a><p className="whitespace-pre-wrap break-words text-slate-400">Supplied Passage: {source.passage}</p></div>)}</section>
   <section className="space-y-2"><h3 className="font-medium">Measurement Caveat</h3><ul className="space-y-2 text-xs text-amber-300">{result.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></section>
  </>}
 </article>;
}
export function NewsjackVisibilityPanel({projectId,canWrite,canRun,administrator=false,history:initialHistory}:{projectId:number;canWrite:boolean;canRun:boolean;administrator?:boolean;history:VisibilityRun[]}){
 const [fields,setFields]=useState<Record<string,string>>({documentType:'press-release'}),[publicOnly,setPublicOnly]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [history,setHistory]=useState(initialHistory),[selected,setSelected]=useState<VisibilityRun|null>(initialHistory[0]??null);
 function update(key:string,value:string){setFields(old=>({...old,[key]:value}));setPublicOnly(false);}
 function field(label:string,key:string,placeholder:string,max:number,rows=2){return <label key={key} className="block space-y-1 text-sm">{label}<textarea aria-label={label} className={inputClass} disabled={busy} maxLength={max} rows={rows} value={fields[key]??''} onChange={event=>update(key,event.target.value)} placeholder={placeholder}/></label>;}
 async function submit(){
  if(busy||!canWrite||!canRun||!publicOnly)return;
  setBusy(true);setError('');setMessage('');
  try{
   const input={copy:fields.copy,documentType:fields.documentType,publisher:fields.publisher,audience:fields.audience,purpose:fields.purpose,queries:lines(fields.queries??''),evidence:lines(fields.evidence??'').map(line=>{const [url,...passage]=line.split('|');return {url:url.trim(),passage:passage.join('|').trim()};})};
   const response=await fetch('/api/newsjack/visibility',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,publicOnly,action:'audit',input})}),data=await response.json();
   if(!response.ok)throw Error(data.error??'Writing audit is unavailable.');
   setSelected(data.run);setHistory(old=>[data.run,...old].slice(0,15));setMessage('Audit Saved To This Project. No Copy Was Rewritten Or Published.');
  }catch(cause){setError(cause instanceof Error?cause.message:'Writing audit is unavailable.');}finally{setBusy(false);}
 }
 return <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_260px]"><div className="min-w-0 space-y-4">
  <p className="text-sm text-slate-400">Audit supplied public writing for clarity, extractable answers, evidence and attribution. Up to three applicable suggestions; no automatic rewrite, invented facts or fake score.</p>
  <p className="text-xs text-amber-300">Retrieval, Indexing, Technical SEO And Publisher Authority Are Not Tested. No Citation, Ranking, Traffic Or Coverage Is Promised.</p>
  <p className="text-xs text-slate-400">One Cheap-Tier AI Call Per Audit · Shared Newsjack 30-Call UTC Daily Limit · Existing Spend Cap · No Outreach Or Publishing</p>
  {!canWrite&&<p className="text-sm text-amber-300">Read-only project. Readers see saved audits; only the owner or an admin can run a new audit.</p>}
  {canWrite&&<form className="panel min-w-0 space-y-4 p-5" onSubmit={event=>{event.preventDefault();void submit();}}>
   <label className="block space-y-1 text-sm">Document Type<select aria-label="Document Type" className={inputClass} disabled={busy} value={fields.documentType} onChange={event=>update('documentType',event.target.value)}><option value="press-release">Press Release</option><option value="blog">Blog Post</option><option value="contributed-article">Contributed Article</option><option value="expert-explainer">Expert Explainer</option></select></label>
   {field('Intended Publisher','publisher','Supplied publisher or owned publication.',200,1)}
   {field('Human Audience','audience','Who should find this useful?',300,1)}
   {field('Purpose','purpose','What should the supplied document help this reader understand?',500)}
   {field('Public Copy To Audit','copy','Paste the exact public draft; dates, numbers, names, quotes and qualifications will be preserved.',8000,10)}
   {field('Reader Questions','queries','Optional: one actual reader question per line, up to four. No queries are invented.',1200,3)}
   {field('Evidence Declarations','evidence','Optional: one per line, up to four: https://public-source.example/article | Exact passage from your copy. Links are declarations only, not fetched or verified.',12000,4)}
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={publicOnly} onChange={event=>setPublicOnly(event.target.checked)}/>All supplied material is public and approved for use. No private client data.</label>
   <button className={buttonClass} disabled={busy||!publicOnly||!canRun}>{busy?'Auditing…':'Audit Supplied Copy'}</button>
   {!canRun&&<p className="text-sm text-amber-300">AI is not enabled for this account. Saved audits remain available.</p>}
  </form>}
  {message&&<p role="status" className="text-sm text-sky-300">{message}</p>}{error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
  {selected&&<SavedVisibility run={selected} administrator={administrator}/>}
  <section className="panel space-y-2 p-4"><h2 className="font-medium">Measurement Panels — Subsequent Work</h2><p className="text-sm text-slate-400">This first slice audits supplied writing only. Evidence-bound prompt panels, baseline measurement, repeated platform runs and visibility tracking are not implemented. A writing audit is not a measurement result.</p></section>
 </div><aside className="panel min-w-0 space-y-3 p-4"><h2 className="font-medium">Project History</h2>{history.length?history.map(run=><button key={run.id} type="button" disabled={busy} className="block w-full rounded-md p-2 text-left text-sm hover:bg-white/5" onClick={()=>setSelected(run)}>{formatArticleChecked(run.createdAt)} · {run.status}</button>):<p className="text-sm text-slate-500">No saved audits yet.</p>}</aside></div>;
}
