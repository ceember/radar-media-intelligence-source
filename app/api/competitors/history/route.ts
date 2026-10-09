import { after } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCurrentProject } from '@/lib/data';
import { competitorWriteRequest } from '@/lib/competitor-api';
import { archivePageIds, selectArchivePages, startArchiveLookup, finishArchiveLookup, failArchiveLookup, archiveStatuses } from '@/lib/competitor-history';
import { withinResearchDeadline } from '@/lib/web-research';

export const runtime='nodejs';
export const maxDuration=300;
export async function GET(req:Request){
  const deadline=Date.now()+10_000;
  try{
    if(!await withinResearchDeadline(getCurrentUser(),deadline))return Response.json({error:'Sign in to view archive history.'},{status:401});
    const project=await withinResearchDeadline(getCurrentProject(),deadline);
    if(!project)return Response.json({error:'No accessible project.'},{status:404});
    const params=new URL(req.url).searchParams;
    if(Number(params.get('projectId'))!==project.id)return Response.json({error:'The current project changed. Reload the page.'},{status:409});
    let ids:number[];try{ids=archivePageIds(JSON.parse(params.get('ids')??'[]'));}catch{return Response.json({error:'Choose up to five lookup IDs.'},{status:400});}
    return Response.json({statuses:ids.length?await withinResearchDeadline(archiveStatuses(project.id,ids),deadline):[]});
  }catch{return Response.json({error:'Archive status unavailable. Reopen the page to inspect saved history.'},{status:503});}
}
export async function POST(req:Request){
  const deadline=Date.now()+15_000;
  try{
    const context=await withinResearchDeadline(competitorWriteRequest(req),deadline);
    if(context.response)return context.response;
    const {body,project}=context;
    if(body.action==='select'){
      let ids:number[];try{ids=archivePageIds(body.pageIds);}catch{return Response.json({error:'Select up to five distinct public pages.'},{status:400});}
      const result=await withinResearchDeadline(selectArchivePages(project.id,ids),deadline);
      return Response.json(result,{status:result.status});
    }
    if(body.action!=='lookup'||!Number.isSafeInteger(body.pageId)||body.pageId<1)return Response.json({error:'Choose a selected archive page.'},{status:400});
    const preparation=startArchiveLookup(project.id,body.pageId,deadline);
    let result;
    try{result=await withinResearchDeadline(preparation,deadline);}
    catch(error){
      after(async()=>{
        try{const late=await preparation;if(late.job)await failArchiveLookup(late.job,'Archive lookup interrupted before background work started. History remains Unknown. Try again later.');}
        catch{console.error('[archive] Late reservation cleanup failed');}
      });
      throw error;
    }
    const {job,...response}=result;
    if(job)after(()=>finishArchiveLookup(job));
    return Response.json(response,{status:result.status});
  }catch{return Response.json({error:'Archive lookup could not start. Reload to inspect the saved status before retrying.'},{status:503});}
}
