'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CompetitorPage } from '@/lib/competitor-page';

export function ArchiveControls({projectId,pageId,pages=[],selected=[],running=false}:{projectId:number;pageId?:number;pages?:CompetitorPage[];selected?:number[];running?:boolean}){
  const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function request(body:object){
    if(busy)return;setBusy(true);setMessage(pageId?'Requesting one archive index…':'Saving archive selection…');
    try{
      const response=await fetch('/api/competitors/history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,...body})});
      const value=await response.json();setMessage(pageId&&response.status===202?'':value.error??value.message??'Reload to inspect archive evidence.');router.refresh();
    }catch{setMessage('Request interrupted. Reload to inspect the saved status before retrying.');}
    finally{setBusy(false);}
  }
  const button='rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50';
  return <div className="min-w-0 space-y-2">{pageId?<button disabled={busy||running} onClick={()=>request({action:'lookup',pageId})} className={button}>{busy||running?'Checking Archive…':'Check Archive History'}</button>:<form className="space-y-3" onSubmit={event=>{event.preventDefault();const ids=new FormData(event.currentTarget).getAll('pageId').map(Number);if(ids.length>5){setMessage('Select up to five public pages.');return;}void request({action:'select',pageIds:ids});}}>
    <fieldset disabled={busy} className="grid min-w-0 gap-2 sm:grid-cols-2"><legend className="mb-2 text-xs text-slate-400">Choose Up To Five Public Pages</legend>{pages.map(page=><label key={page.id} className="flex min-w-0 items-start gap-2 rounded-lg border border-white/10 p-3 text-xs text-slate-300"><input type="checkbox" name="pageId" value={page.id} defaultChecked={selected.includes(page.id)} className="mt-1"/><span className="min-w-0"><span className="block break-words">{page.entity} · {page.label}</span><span className="block break-all text-slate-500">{page.url}</span></span></label>)}</fieldset>
    <button disabled={busy} className={button}>{busy?'Saving…':'Save Archive Selection'}</button>
  </form>}<p role="status" className="break-words text-xs text-slate-400">{message}</p></div>;
}

/** One read-only poll for the visible page, rather than one per selected URL. */
export function ArchiveStatusPoll({projectId,ids}:{projectId:number;ids:number[]}) {
  const router=useRouter(),[message,setMessage]=useState(''),key=JSON.stringify(ids);
  useEffect(()=>{
    let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,attempts=0;
    const controller=new AbortController();
    async function poll(){
      if(stopped)return;
      if(document.visibilityState!=='hidden')try{
        const params=new URLSearchParams({projectId:String(projectId),ids:key});
        const response=await fetch('/api/competitors/history?'+params,{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw Error('Status unavailable');
        const value=await response.json();
        if(!stopped&&(value.statuses.length!==JSON.parse(key).length||value.statuses.some((s:{status:string})=>s.status!=='running'))){router.refresh();return;}
      }catch{if(!stopped)setMessage('Status temporarily unavailable. Reopen this page to inspect saved history.');}
      if(!stopped&&++attempts<30)timer=setTimeout(poll,10_000);
      else if(!stopped)setMessage('Reopen this page to inspect the saved archive status.');
    }
    timer=setTimeout(poll,10_000);
    return()=>{stopped=true;clearTimeout(timer);controller.abort();};
  },[projectId,key,router]);
  return <p role="status" className="text-xs text-slate-400">{message||'Checking the archive, this can take a few minutes'}</p>;
}
