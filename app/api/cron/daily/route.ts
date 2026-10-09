import { after, NextResponse } from 'next/server';
import { runPipeline } from '@/lib/pipeline';
import { getDb } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { cronProjectId, cronStartupBudget, dailyCronEndpoint, startDaily } from '@/lib/daily-cron';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Cron giornaliero Vercel: pipeline completa + digest Telegram del mattino.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'non autorizzato' }, { status: 401 });
  }
  try {
    const projectId = cronProjectId(req.url);
    if (projectId !== null) {
      const db = await getDb();
      const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
      if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });
      return NextResponse.json(await runPipeline({ full: true, digest: true, projectId, system: 'cron' }));
    }
    const endpoint = dailyCronEndpoint(process.env);
    if (!endpoint) return NextResponse.json({ error: 'Cron origin is not configured' }, { status: 503 });
    const ids = await cronStartupBudget((async () => {
      const db = await getDb();
      return db.select({ id: projects.id }).from(projects);
    })());
    // after() uses Vercel waitUntil: the response does not await child pipelines.
    return NextResponse.json(startDaily(ids.map(p => p.id), endpoint, secret, after), { status: 202 });
  } catch (e) {
    if ((e as Error).message === 'invalid project') {
      return NextResponse.json({ error: 'invalid project' }, { status: 400 });
    }
    console.error('Cron giornaliero fallito:', e);
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
