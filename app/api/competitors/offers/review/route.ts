import { getCurrentUser } from '@/lib/auth';
import { competitorWriteRequest } from '@/lib/competitor-api';
import { parseOfferReview } from '@/lib/competitor-offer-input';
import { saveOfferReview } from '@/lib/competitor-offer-reviews';
import { withinResearchDeadline } from '@/lib/web-research';

export const maxDuration = 15;
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const deadline = Date.now() + 10_000;
  try {
    const context = await withinResearchDeadline(competitorWriteRequest(req), deadline);
    if (context.response) return context.response;
    let input;
    try { input = parseOfferReview(context.body); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid correction.' }, { status: 400 }); }
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: 'Sign in to record a correction.' }, { status: 401 });
    const id = await withinResearchDeadline(saveOfferReview(context.project.id, user.id, input), deadline);
    return id ? Response.json({ id, message: 'Human correction saved beside the original publisher evidence.' }) : Response.json({ error: 'Captured offer not found in this project.' }, { status: 404 });
  } catch { return Response.json({ error: 'Saving exceeded its request budget. Reload before submitting again.' }, { status: 503 }); }
}
