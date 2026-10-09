import { getCurrentUser } from '@/lib/auth';
import { getCurrentProject } from '@/lib/data';
import { isDemoMode } from '@/lib/session';
import { triageProject } from '@/lib/text-triage-store';
import { getDb } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const maxDuration = 60;

async function writableProject() {
  const user = await getCurrentUser();
  const project = user && await getCurrentProject();
  return !isDemoMode() && user && project && (user.role === 'admin' || project.ownerId === user.id) ? project : null;
}

export async function POST() {
  const project = await writableProject();
  if (!project) return Response.json({ error: 'Project owner or admin required.' }, { status: 403 });
  try { return Response.json(await triageProject(project.id)); }
  catch { return Response.json({ error: 'Suggestions could not be generated. Try again.' }, { status: 503 }); }
}

export async function PATCH(request: Request) {
  const project = await writableProject();
  if (!project) return Response.json({ error: 'Project owner or admin required.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!Number.isSafeInteger(body?.mentionId) || body.mentionId < 1 || !['reviewed', 'dismissed', 'unreviewed'].includes(body.review)) {
    return Response.json({ error: 'Invalid review.' }, { status: 400 });
  }
  const db = await getDb();
  const result = await db.execute(sql`UPDATE mentions SET text_suggestions = jsonb_set(text_suggestions, '{review}', ${JSON.stringify(body.review)}::jsonb)
    WHERE id = ${body.mentionId} AND project_id = ${project.id} AND text_suggestions IS NOT NULL RETURNING id`);
  return Response.json({ saved: result.rows.length }, { status: result.rows.length ? 200 : 404 });
}
