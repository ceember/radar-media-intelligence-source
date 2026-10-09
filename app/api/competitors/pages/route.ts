import { competitorWriteRequest } from '@/lib/competitor-api';
import { addCompetitorPage } from '@/lib/competitor-snapshots';
import { selectedPublicUrl, utf8Bound } from '@/lib/competitor-page';
import { configuredCompetitorSeed } from '@/lib/competitor-seed';
import { withinResearchDeadline } from '@/lib/web-research';

export const maxDuration = 60;
export async function POST(req: Request) {
  const deadline = Date.now() + 45_000;
  const wait = <T>(p: PromiseLike<T>) => withinResearchDeadline(p, deadline);
  try {
    const context = await wait(competitorWriteRequest(req));
    if (context.response) return context.response;
    const { project, body } = context;
    if (body.action === 'seed') {
      const selection = configuredCompetitorSeed(project);
      if (!selection) return Response.json({ error: 'No public selection is configured for this project.' }, { status: 409 });
      let added = 0;
      for (const page of selection.pages) {
        if (Date.now() >= deadline) throw new Error('Selection deadline reached.');
        if (await wait(addCompetitorPage(project.id, page.entity, page.label, page.url))) added++;
      }
      return Response.json({ message: `${added} public pages selected. Existing selections were preserved.` });
    }
    let url: string;
    try { url = selectedPublicUrl(body.url); } catch { return Response.json({ error: 'Enter a public HTTPS page URL without credentials, a port or fragment.' }, { status: 400 }); }
    const entity = typeof body.entity === 'string' ? utf8Bound(body.entity.trim(), 120) : '';
    const label = typeof body.label === 'string' ? utf8Bound(body.label.trim(), 120) : '';
    if (!entity || !label) return Response.json({ error: 'Enter a brand and page label.' }, { status: 400 });
    const id = await wait(addCompetitorPage(project.id, entity, label, url));
    return id ? Response.json({ id, message: 'Public page selected.' }) : Response.json({ error: 'Already selected, or all ten page slots are used. Reload to see the current selection.' }, { status: 409 });
  } catch { return Response.json({ error: 'The page selection could not be saved.' }, { status: 503 }); }
}
