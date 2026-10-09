import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { getCurrentUser, userAiEnabled } from '@/lib/auth';
import { getCurrentProject } from '@/lib/data';
import { getDb } from '@/lib/db';
import { researchRuns } from '@/lib/db/schema';
import { aiStatus, callClaude, MODELS } from '@/lib/claude';
import { isDemoMode } from '@/lib/session';
import { researchCanWrite, researchQuestion, researchSameOrigin, withinResearchDeadline } from '@/lib/web-research';
import { researchTavilyKey } from '@/lib/tavily-research';
import { researchGateway } from '@/lib/gateway-search';
import { readResearchSources, searchWithProviders } from '@/lib/research-providers';
import { researchHistory, reserveResearchRun, savedResearchRun } from '@/lib/research-store';
import type { ResearchEvent } from '@/lib/web-research-types';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Sign in to view research.' }, { status: 401 });
  const project = await getCurrentProject();
  if (!project) return Response.json({ error: 'No accessible project.' }, { status: 404 });
  const params = new URL(req.url).searchParams;
  if (Number(params.get('projectId')) !== project.id) return Response.json({ error: 'The current project changed. Reload the page.' }, { status: 409 });
  if (params.has('id')) {
    const id = Number(params.get('id'));
    if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: 'Invalid run id.' }, { status: 400 });
    const run = await savedResearchRun(project.id, id);
    return run ? Response.json({ run }) : Response.json({ error: 'Research run not found in this project.' }, { status: 404 });
  }
  return Response.json({ history: await researchHistory(project.id) });
}

export async function POST(req: Request) {
  const started = Date.now(), deadline = started + 105_000, saveDeadline = started + 115_000;
  const wait = <T>(p: PromiseLike<T>) => withinResearchDeadline(p, deadline);
  try {
    const origin = req.headers.get('origin');
    if (!researchSameOrigin(origin, req.url, req.headers.get('host'))) return Response.json({ error: 'Cross-site research requests are not allowed.' }, { status: 403 });
    if (!req.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'Send a JSON research question.' }, { status: 415 });
    const user = await wait(getCurrentUser());
    if (!user) return Response.json({ error: 'Sign in to run research.' }, { status: 401 });
    if (isDemoMode() || !userAiEnabled(user)) return Response.json({ error: 'Research AI is not enabled for this account.' }, { status: 403 });
    if (Number(req.headers.get('content-length')) > 8000) return Response.json({ error: 'Question is too large.' }, { status: 400 });
    const raw = await wait(req.text());
    if (raw.length > 8000) return Response.json({ error: 'Question is too large.' }, { status: 400 });
    let body;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    const question = typeof body?.question === 'string' ? body.question.toWellFormed().replace(/\u0000/g, '').trim() : '';
    if (question.length < 3 || question.length > 1600) return Response.json({ error: 'Enter a question between 3 and 1600 characters.' }, { status: 400 });
    const project = await wait(getCurrentProject());
    if (!project) return Response.json({ error: 'No accessible project.' }, { status: 404 });
    if (body.projectId !== project.id) return Response.json({ error: 'The current project changed. Reload the page.' }, { status: 409 });
    if (!researchCanWrite(user, project)) return Response.json({ error: 'Only the project owner or an admin can run research. Shared history is read-only.' }, { status: 403 });
    const [ai, key] = await wait(Promise.all([aiStatus(), researchTavilyKey()]));
    if (!ai.ready) return Response.json({ error: ai.capReached ? 'AI spend cap reached.' : 'AI is not configured.' }, { status: ai.capReached ? 429 : 503 });
    const gateway = researchGateway();
    if (!key && !gateway) return Response.json({ error: 'No search provider is configured. Add a Tavily key in Settings or configure the server search gateway.' }, { status: 503 });
    const db = await wait(getDb());
    const reservation = reserveResearchRun(project.id, user.id, question, db);
    let id: number | null;
    try { id = await wait(reservation); }
    catch (error) {
      // Retain late DB completion after a 503; failed runs still consume their slot.
      after(async () => {
        try {
          const lateId = await reservation;
          if (lateId !== null) await db.update(researchRuns).set({ status: 'failed',
            error: 'Research timed out before starting. No provider was called.' })
            .where(and(eq(researchRuns.id, lateId), eq(researchRuns.projectId, project.id)));
        } catch { console.error('[research] Late reservation cleanup failed'); }
      });
      throw error;
    }
    if (id === null) return Response.json({ error: 'Daily research limit reached (20 runs). Resets at midnight UTC.' }, { status: 429 });
    const scope = and(eq(researchRuns.id, id), eq(researchRuns.projectId, project.id));
    const abort = new AbortController();
    if (req.signal.aborted) abort.abort();
    req.signal.addEventListener('abort', () => abort.abort(), { once: true });
    let closed = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: ResearchEvent) => { if (!closed) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); };
        try {
          const result = await researchQuestion(question, {
            ai: (tier, system, input, tokens, timeout) => callClaude(tier === 'fast' ? MODELS.haiku : MODELS.sonnet,
              `web_research_${tier}`, system, input, tokens, false, timeout),
            search: (query, timeout) => searchWithProviders(query, key, gateway, timeout),
            extract: (sources, timeout) => readResearchSources(sources, key, timeout),
            snapshot: async (value) => { await db.update(researchRuns).set(value).where(scope); },
          }, emit, deadline, abort.signal);
          await withinResearchDeadline(db.update(researchRuns).set({ ...result, status: 'complete' }).where(scope), saveDeadline);
          const run = await withinResearchDeadline(savedResearchRun(project.id, id), saveDeadline);
          if (!run) throw new Error('Research could not be loaded after saving.');
          emit({ type: 'done', run });
        } catch (e) {
          const message = e instanceof Error && /^(Research |AI |The answer |No public |None of |Tavily )/.test(e.message)
            ? e.message : 'Research failed. The available source snapshot remains in history.';
          try { await withinResearchDeadline(db.update(researchRuns).set({ status: 'failed', error: message }).where(scope), saveDeadline); }
          catch { /* Initial run and earlier snapshots remain durable even when final saving fails. */ }
          emit({ type: 'error', error: message, runId: id });
        } finally {
          if (!closed) { closed = true; controller.close(); }
        }
      },
      cancel() { closed = true; abort.abort(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
  } catch {
    return Response.json({ error: 'Research could not start within its time limit. Please try again later.' }, { status: 503 });
  }
}
