import { competitorWriteRequest } from '@/lib/competitor-api';
import { parseAdObservation } from '@/lib/competitor-ad-input';
import { saveAdObservation } from '@/lib/competitor-ads';
import { getCurrentUser } from '@/lib/auth';
import { withinResearchDeadline } from '@/lib/web-research';

export const runtime = 'nodejs';
export const maxDuration = 15;
export async function POST(req: Request) {
  const deadline = Date.now() + 10_000;
  try {
    const context = await withinResearchDeadline(competitorWriteRequest(req), deadline);
    if (context.response) return context.response;
    let input;
    try { input = parseAdObservation(context.body); } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Check the observation fields.' }, { status: 400 });
    }
    const user = await withinResearchDeadline(getCurrentUser(), deadline);
    if (!user) return Response.json({ error: 'Sign in to record an observation.' }, { status: 401 });
    const id = await withinResearchDeadline(saveAdObservation(context.project.id, user.id, input), deadline);
    return id ? Response.json({ id, message: 'Observation saved. Observed by a person.' })
      : Response.json({ error: 'Benchmark brand not found in this project.' }, { status: 404 });
  } catch { return Response.json({ error: 'The observation could not be confirmed. Reload the log before submitting again.' }, { status: 503 }); }
}
