import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { getCurrentUser } from '@/lib/auth';
import { getCurrentProject } from '@/lib/data';
import { getDb } from '@/lib/db';
import { mentions } from '@/lib/db/schema';
import { isDemoMode } from '@/lib/session';
import { researchCanWrite, researchSameOrigin } from '@/lib/web-research';
import { fetchArticleText } from '@/lib/article-text';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    if (!researchSameOrigin(req.headers.get('origin'), req.url, req.headers.get('host')))
      return Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 });
    if (!req.headers.get('content-type')?.startsWith('application/json'))
      return Response.json({ error: 'Send JSON.' }, { status: 415 });
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: 'Sign in.' }, { status: 401 });
    const project = await getCurrentProject();
    if (!project) return Response.json({ error: 'No accessible project.' }, { status: 404 });
    if (isDemoMode() || !researchCanWrite(user, project))
      return Response.json({ error: 'Only the project owner or an admin can update extraction details.' }, { status: 403 });
    if (Number(req.headers.get('content-length')) > 1000) return Response.json({ error: 'Request too large.' }, { status: 400 });
    const raw = await req.text();
    if (raw.length > 1000) return Response.json({ error: 'Request too large.' }, { status: 400 });
    let body;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    if (body?.projectId !== project.id) return Response.json({ error: 'Reload the current project.' }, { status: 409 });
    if (!Number.isSafeInteger(body?.mentionId) || body.mentionId < 1) return Response.json({ error: 'Invalid article.' }, { status: 400 });
    const db = await getDb();
    const scope = and(eq(mentions.id, body.mentionId), eq(mentions.projectId, project.id), eq(mentions.kind, 'article'), isNotNull(mentions.articleText));
    const [mention] = await db.select().from(mentions).where(scope).limit(1);
    if (!mention) return Response.json({ error: 'Article not found.' }, { status: 404 });
    if (mention.articleMeta) return Response.json({ article: { text: mention.articleText, metadata: mention.articleMeta } });
    if (!mention.url) return Response.json({ article: null });
    // Atomic durable one-time claim, including failed attempts. Never clear the old text on failure.
    const claimed = await db.update(mentions).set({ articleMetaAttemptedAt: new Date() })
      .where(and(scope, isNull(mentions.articleMeta), isNull(mentions.articleMetaAttemptedAt))).returning({ id: mentions.id });
    if (!claimed.length) return Response.json({ article: null });
    const extracted = await fetchArticleText(mention.url);
    if (!extracted.ok) return Response.json({ article: null });
    const article = { text: extracted.text, metadata: extracted.metadata };
    await db.update(mentions).set({ articleText: article.text, articleMeta: article.metadata, articleAt: new Date() })
      .where(and(scope, isNull(mentions.articleMeta)));
    return Response.json({ article });
  } catch {
    return Response.json({ error: 'Extraction details are unavailable.' }, { status: 503 });
  }
}
