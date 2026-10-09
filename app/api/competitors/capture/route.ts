import { competitorWriteRequest } from '@/lib/competitor-api';
import { captureCompetitorPage } from '@/lib/competitor-snapshots';
import { withinResearchDeadline } from '@/lib/web-research';

export const maxDuration = 60;
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const deadline = Date.now() + 50_000;
  try {
    const context = await withinResearchDeadline(competitorWriteRequest(req), deadline);
    if (context.response) return context.response;
    if (!Number.isSafeInteger(context.body.pageId) || context.body.pageId < 1)
      return Response.json({ error: 'Invalid selected page.' }, { status: 400 });
    const result = await withinResearchDeadline(captureCompetitorPage(context.project.id, context.body.pageId, deadline - 3000), deadline);
    return Response.json(result, { status: result.status });
  } catch { return Response.json({ error: 'Capture exceeded its request budget. Any reserved attempt remains unknown in history; reload to check.' }, { status: 503 }); }
}
