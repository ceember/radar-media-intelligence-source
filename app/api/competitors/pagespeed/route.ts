import { competitorWriteRequest } from '@/lib/competitor-api';
import { auditCompetitorPage } from '@/lib/competitor-pagespeed';
import { withinResearchDeadline } from '@/lib/web-research';

export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(req: Request) {
  const started = Date.now();
  try {
    const context = await withinResearchDeadline(competitorWriteRequest(req), started + 20_000);
    if (context.response) return context.response;
    if (!Number.isSafeInteger(context.body.pageId) || context.body.pageId < 1 || !['mobile', 'desktop'].includes(context.body.strategy))
      return Response.json({ error: 'Choose a selected page and mobile or desktop strategy.' }, { status: 400 });
    const provider = context.body.provider ?? 'google';
    if (!['google','f9'].includes(provider)) return Response.json({ error: 'Choose an available lab provider.' }, { status: 400 });
    const deadline = started + (provider === 'f9' ? 110_000 : 20_000);
    const result = await withinResearchDeadline(auditCompetitorPage(context.project.id, context.body.pageId, context.body.strategy, deadline, provider), deadline);
    return Response.json(result, { status: result.status });
  } catch { return Response.json({ error: 'The public target was unavailable or the audit exceeded its request budget. Reload to check any reserved attempt; no automatic retry.' }, { status: 503 }); }
}
