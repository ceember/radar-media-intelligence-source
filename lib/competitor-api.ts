import { getCurrentUser } from '@/lib/auth';
import { getCurrentProject } from '@/lib/data';
import { isDemoMode } from '@/lib/session';
import { researchCanWrite, researchSameOrigin, withinResearchDeadline } from '@/lib/web-research';

export async function competitorWriteRequest(req: Request) {
  if (!researchSameOrigin(req.headers.get('origin'), req.url, req.headers.get('host')))
    return { response: Response.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 }) };
  const user = await getCurrentUser();
  if (!user) return { response: Response.json({ error: 'Sign in to save competitor evidence.' }, { status: 401 }) };
  const project = await getCurrentProject();
  if (!project) return { response: Response.json({ error: 'No accessible project.' }, { status: 404 }) };
  if (isDemoMode() || !researchCanWrite(user, project))
    return { response: Response.json({ error: 'Only the project owner or an admin can save competitor evidence. Shared history is read-only.' }, { status: 403 }) };
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    return { response: Response.json({ error: 'Send a JSON request.' }, { status: 415 }) };
  if (Number(req.headers.get('content-length')) > 4000 || !req.body)
    return { response: Response.json({ error: 'Send a JSON request up to 4000 bytes.' }, { status: 400 }) };
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  const deadline = Date.now() + 3000;
  let length = 0;
  try {
    while (true) {
      const part = await withinResearchDeadline(reader.read(), deadline);
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 4000) return { response: Response.json({ error: 'Request too large.' }, { status: 400 }) };
      chunks.push(part.value);
    }
  } finally { void reader.cancel().catch(() => undefined); }
  const raw = Buffer.concat(chunks).toString('utf8');
  let body;
  try { body = JSON.parse(raw); } catch { return { response: Response.json({ error: 'Invalid JSON.' }, { status: 400 }) }; }
  if (body?.projectId !== project.id)
    return { response: Response.json({ error: 'The current project changed. Reload the page.' }, { status: 409 }) };
  return { project, body };
}
