import { after } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCurrentProject } from '@/lib/data';
import { isDemoMode } from '@/lib/session';
import { researchCanWrite, researchSameOrigin, withinResearchDeadline } from '@/lib/web-research';
import { cleanStoredText } from '@/lib/text-clean';
import { publisherUrl, feedSelectors, fetchPublisherItems, pageFeedFailure } from '@/lib/feed-from-page';
import { pageFeedSource, savePageFeed, claimPageFeedRefresh, storePageFeedItems, failPageFeed } from '@/lib/page-feed-store';
import { readPageFeedBody } from '@/lib/page-feed-request';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=40;

export async function POST(req: Request) {
  const deadline=Date.now()+35_000, wait=<T>(p:PromiseLike<T>)=>withinResearchDeadline(p,deadline);
  try {
    if (!researchSameOrigin(req.headers.get('origin'),req.url,req.headers.get('host'))) return Response.json({error:'Cross-site requests are not allowed.'},{status:403});
    if (!req.headers.get('content-type')?.startsWith('application/json')) return Response.json({error:'Send JSON.'},{status:415});
    const user=await wait(getCurrentUser());
    if (!user) return Response.json({error:'Sign in.'},{status:401});
    const project=await wait(getCurrentProject());
    if (!project) return Response.json({error:'No accessible project.'},{status:404});
    if (isDemoMode() || !researchCanWrite(user,project)) return Response.json({error:'Only the project owner or an admin can configure or refresh publisher feeds.'},{status:403});
    if (Number(req.headers.get('content-length'))>6000) return Response.json({error:'Request too large.'},{status:400});
    let raw;
    try { raw=await wait(readPageFeedBody(req)); }
    catch { return Response.json({error:'Request body is invalid, too large or timed out.'},{status:400}); }
    if (Buffer.byteLength(raw)>6000) return Response.json({error:'Request too large.'},{status:400});
    let body;
    try {body=JSON.parse(raw)} catch {return Response.json({error:'Invalid JSON.'},{status:400})}
    if (body?.projectId!==project.id) return Response.json({error:'The current project changed. Reload.'},{status:409});
    if (body.action==='save') {
      const name=typeof body.name==='string'?cleanStoredText(body.name.trim(),200):'',url=publisherUrl(body.url),selectors=feedSelectors(body.selectors);
      if (!name || !url || !selectors || body.permission!==true) return Response.json({error:'Confirm a reviewed public static publisher source and enter valid basic selectors.'},{status:400});
      if (!await wait(savePageFeed(project.id,{name,url,selectors}))) return Response.json({error:'Deployment source limit reached (20). No new source was saved.'},{status:429});
      return Response.json({saved:true});
    }
    if (body.action!=='refresh') return Response.json({error:'Unknown action.'},{status:400});
    const refresh = async () => {
    const source=await claimPageFeedRefresh(project.id);
    if (!source) {
      const existing=await wait(pageFeedSource(project.id));
      return Response.json({error:existing?'One refresh per source per hour. Edits do not reset the limit.':'Save an approved publisher source first.'},{status:existing?429:404});
    }
    try {
      const items=await fetchPublisherItems(source.url,source.selectors);
      if (!await storePageFeedItems(source,items)) return Response.json({error:'Source settings changed during reading. Observations were not applied to the new settings.'},{status:409});
      return Response.json({status:'ready',items:items.length});
    } catch (error) {
      const message=pageFeedFailure(error);
      await failPageFeed(source,message);
      return Response.json({status:'unavailable',error:message},{status:422});
    }
    };
    const work = refresh();
    after(async () => { await work.catch(() => undefined); });
    return await wait(work);
  } catch { return Response.json({error:'Publisher feed request failed or timed out. Previous observations remain stored.'},{status:503}); }
}
