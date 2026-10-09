import { after } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCurrentProject } from '@/lib/data';
import { isDemoMode } from '@/lib/session';
import { researchCanWrite, researchSameOrigin, withinResearchDeadline } from '@/lib/web-research';
import { blueskyMentionIds } from '@/lib/bluesky-context';
import { refreshBlueskyContexts, savedBlueskyContext } from '@/lib/bluesky-context-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;
const privateHeaders = { 'Cache-Control':'private, no-store',Vary:'Cookie' };
const response = (body: unknown,status = 200) => Response.json(body,{ status,headers:privateHeaders });

async function readBody(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared)>1000)) throw new Error('Invalid body.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Invalid body.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes>1000) { await reader.cancel(); throw new Error('Invalid body.'); }
      chunks.push(part.value);
    }
    return JSON.parse(new TextDecoder('utf-8',{ fatal:true }).decode(Buffer.concat(chunks)));
  } finally { reader.releaseLock(); }
}

export async function GET(request: Request) {
  const deadline = Date.now()+25_000;
  const wait = <Value>(work: PromiseLike<Value>) => withinResearchDeadline(work,deadline);
  try {
    if (!await wait(getCurrentUser())) return response({ error:'Sign in to read saved context.' },401);
    const project = await wait(getCurrentProject());
    if (!project) return response({ error:'No accessible project.' },404);
    const query = new URL(request.url).searchParams;
    if (Number(query.get('projectId'))!==project.id) return response({ error:'The current project changed. Reload.' },409);
    const mentionId = Number(query.get('mentionId'));
    if (!Number.isSafeInteger(mentionId) || mentionId<1) return response({ error:'Choose a stored Bluesky mention.' },400);
    const context = await wait(savedBlueskyContext(project.id,mentionId));
    return context ? response({ context }) : response({ error:'No saved public context for this post in the current project.' },404);
  } catch { return response({ error:'Saved context could not be read or timed out.' },503); }
}

export async function POST(request: Request) {
  const deadline = Date.now()+85_000;
  const wait = <Value>(work: PromiseLike<Value>) => withinResearchDeadline(work,deadline);
  try {
    if (!researchSameOrigin(request.headers.get('origin'),request.url,request.headers.get('host'))) {
      return response({ error:'Cross-site context reading is not allowed.' },403);
    }
    if (!request.headers.get('content-type')?.startsWith('application/json')) return response({ error:'Send JSON.' },415);
    const user = await wait(getCurrentUser());
    if (!user) return response({ error:'Sign in to read public context.' },401);
    const project = await wait(getCurrentProject());
    if (!project) return response({ error:'No accessible project.' },404);
    if (isDemoMode() || !researchCanWrite(user,project)) return response({ error:'Only the project owner or an admin may fetch public context.' },403);
    let body: Record<string, unknown>;
    try {
      const value = await wait(readBody(request));
      if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid body.');
      body = value as Record<string, unknown>;
    } catch { return response({ error:'Send a valid JSON request of at most 1000 bytes.' },400); }
    if (body.projectId!==project.id) return response({ error:'The current project changed. Reload.' },409);
    let ids: number[];
    try { ids = blueskyMentionIds(body.mentionIds); }
    catch { return response({ error:'Select one to five distinct stored Bluesky mentions.' },400); }
    const work = refreshBlueskyContexts(project.id,ids,deadline);
    after(async () => { await work.catch(() => undefined); });
    const result = await wait(work);
    return response(result,result.status);
  } catch { return response({ error:'Public context reading failed or timed out. Reload saved status; no retry was attempted.' },503); }
}
