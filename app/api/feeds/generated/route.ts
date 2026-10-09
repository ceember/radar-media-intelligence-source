import { getCurrentUser } from '@/lib/auth';
import { getCurrentProject } from '@/lib/data';
import { pageFeedSource, pageFeedItems } from '@/lib/page-feed-store';
import { serializePageFeed, type FeedFormat } from '@/lib/feed-serialize';
import { withinResearchDeadline } from '@/lib/web-research';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;

export async function GET(req: Request) {
  const deadline=Date.now()+25_000, wait=<T>(work:PromiseLike<T>)=>withinResearchDeadline(work,deadline);
  try {
  if (!await wait(getCurrentUser())) return Response.json({error:'Sign in to read this feed.'},{status:401});
  const project=await wait(getCurrentProject());
  if (!project) return Response.json({error:'No accessible project.'},{status:404});
  const params=new URL(req.url).searchParams,format=params.get('format');
  if (Number(params.get('projectId'))!==project.id) return Response.json({error:'Reload the current project.'},{status:409});
  if (!['rss','atom','json'].includes(format ?? '')) return Response.json({error:'Choose rss, atom or json.'},{status:400});
  const source=await wait(pageFeedSource(project.id));
  if (!source) return Response.json({error:'No approved publisher source.'},{status:404});
  if (source.status!=='ready') return Response.json({error:'Publisher source is not ready. Check its status in Sources.'},{status:422});
  try {
    const items=await wait(pageFeedItems(source)),result=serializePageFeed(source,items,format as FeedFormat);
    const headers={'Content-Type':`${result.contentType}; charset=utf-8`,'Cache-Control':'private, no-cache',Vary:'Cookie',ETag:result.etag};
    return new Response(req.headers.get('if-none-match')===result.etag?null:result.body,{status:req.headers.get('if-none-match')===result.etag?304:200,headers});
  } catch {return Response.json({error:'Feed export exceeded its bounds or could not be generated.'},{status:503})}
  } catch { return Response.json({error:'Feed export failed or timed out.'},{status:503}); }
}
