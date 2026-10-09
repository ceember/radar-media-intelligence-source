import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getCurrentProject } from '@/lib/data';
import { getDb } from '@/lib/db';
import { mentions } from '@/lib/db/schema';
import { isDemoMode } from '@/lib/session';
import { researchCanWrite, researchSameOrigin, withinResearchDeadline } from '@/lib/web-research';
import { readPublicArticle, type ReaderState } from '@/lib/article-reader-fallback';
import { reserveReaderRequest } from '@/lib/article-reader-store';
import { fetchPublicText, validatePublicUrl } from '@/lib/public-http';
import type { ReaderReason } from '@/lib/article-reader-reasons';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function readingError(error:string,status:number,reason:ReaderReason) {
  console.info('[article-reader]',{reason});
  return Response.json({error,reason},{status});
}

export async function POST(req: Request) {
  const deadline = Date.now() + 55_000;
  const wait = <T>(promise: PromiseLike<T>) => withinResearchDeadline(promise, deadline);
  try {
    if (!researchSameOrigin(req.headers.get('origin'), req.url, req.headers.get('host')))
      return readingError('Cross-site reading is not allowed.',403,'cross_site_denied');
    if (!req.headers.get('content-type')?.startsWith('application/json'))
      return readingError('Send a JSON reading request.',415,'request_not_json');
    const user = await wait(getCurrentUser());
    if (!user) return readingError('Sign in to read articles.',401,'sign_in_required');
    if (isDemoMode()) return readingError('Article reading is disabled in this environment.',403,'environment_disabled');
    const project = await wait(getCurrentProject());
    if (!project) return readingError('No accessible project.',404,'project_missing');
    if (!researchCanWrite(user, project)) return readingError('Only the project owner or an admin can read public pages.',403,'write_not_allowed');
    if (Number(req.headers.get('content-length')) > 1000) return readingError('Request too large.',400,'request_too_large');
    const raw = await wait(req.text());
    if (raw.length > 1000) return readingError('Request too large.',400,'request_too_large');
    let body;
    try { body = JSON.parse(raw); } catch { return readingError('Invalid JSON.',400,'invalid_json'); }
    if (body?.projectId !== project.id) return readingError('The current project changed. Reload the page.',409,'project_changed');
    if (!Number.isSafeInteger(body?.mentionId) || body.mentionId < 1 || body.permission !== true)
      return readingError('Confirm permission for this public article.',400,body.permission!==true?'permission_missing':'invalid_read_request');
    const db = await wait(getDb());
    const scope = and(eq(mentions.id, body.mentionId), eq(mentions.projectId, project.id), eq(mentions.kind, 'article'));
    const [mention] = await wait(db.select().from(mentions).where(scope).limit(1));
    if (!mention?.url) return readingError('Article not found in this project.',404,'article_not_found');
    if (mention.articleText) {
      const reason=mention.articleMeta?.method === 'jina'?'outside_read':'native_readable';
      console.info('[article-reader]',{reason});
      return Response.json({ status: mention.articleMeta?.method === 'jina' ? 'read' : 'native',reason });
    }
    const checkedAt = new Date().toISOString();
    const reading: ReaderState = { status: 'reading', provider: 'native', originalUrl: mention.url,
      checkedAt, permissionConfirmedAt: checkedAt,reason:'reading_started' };
    const claimed = await wait(db.update(mentions).set({ articleReaderAt: new Date(), articleReader: reading }).where(and(scope,
      or(isNull(mentions.articleReaderAt), sql`${mentions.articleReaderAt} <= CURRENT_TIMESTAMP - INTERVAL '60 seconds'`)))
      .returning({ id: mentions.id }));
    if (!claimed.length) return readingError('A reading was started recently. Wait 60 seconds.',429,'reading_recent');
    const result = await wait(readPublicArticle(mention.url, true, {
      fetchPage: fetchPublicText, validate: validatePublicUrl, reserve: () => reserveReaderRequest(db),
    }));
    await wait(db.update(mentions).set({ articleReader: result.state, ...(result.article ? {
      articleText: result.article.text, articleMeta: result.article.metadata, articleAt: new Date(),
    } : {}) }).where(scope));
    return Response.json({ status: result.state.status, provider: result.state.provider,reason:result.state.reason });
  } catch {
    return readingError('Article reading failed or timed out. No paid retry was attempted.',503,'read_action_failed');
  }
}
