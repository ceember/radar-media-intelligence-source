import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { getInitializedDb } from '@/lib/db';
import { projects, users } from '@/lib/db/schema';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROJECT_ID = 67;
const processNonce = randomUUID();
const countFields = ['n', 'reddit_n', 'gdelt_n', 'unique_url_n', 'file67_n', 'file68_n',
  'topics_null_n', 'topics_nonempty_n', 'topics_other_type_n', 'emotion_nonnull_n'] as const;

function reply(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (process.env.RADAR_TYPED_AUDIT_ENABLED !== '1'
      || process.env.RADAR_TYPED_AUDIT_PROJECT_ID !== String(PROJECT_ID)
      || process.env.DEMO_MODE !== undefined
      || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32
      || url.pathname !== '/api/internal/project67-typed-inventory'
      || url.search || url.hash || req.body) return reply({ error: 'NOT_FOUND' }, 404);

  const userId = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (userId === null) return reply({ error: 'UNAUTHORIZED' }, 401);

  let db: ReturnType<typeof getInitializedDb>;
  try {
    db = getInitializedDb();
  } catch (error) {
    if (error instanceof Error && error.message === 'HOLD: database not initialized')
      return reply({ error: 'HOLD_COLD_DB' }, 503);
    throw error;
  }

  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (user?.role !== 'admin') return reply({ error: 'FORBIDDEN' }, 403);
  const [project] = await db.select({ id: projects.id }).from(projects)
    .where(eq(projects.id, PROJECT_ID)).limit(1);
  if (!project) return reply({ error: 'NOT_FOUND' }, 404);

  const result = await db.execute(sql`
    SELECT count(*)::int AS n,
      count(*) FILTER (WHERE source = 'reddit')::int AS reddit_n,
      count(*) FILTER (WHERE source = 'gdelt')::int AS gdelt_n,
      count(DISTINCT url)::int AS unique_url_n,
      count(*) FILTER (WHERE import_file_id = 67)::int AS file67_n,
      count(*) FILTER (WHERE import_file_id = 68)::int AS file68_n,
      count(*) FILTER (WHERE topics IS NULL)::int AS topics_null_n,
      count(*) FILTER (WHERE CASE WHEN jsonb_typeof(topics) = 'array'
        THEN jsonb_array_length(topics) > 0 ELSE false END)::int AS topics_nonempty_n,
      count(*) FILTER (WHERE topics IS NOT NULL AND jsonb_typeof(topics) <> 'array')::int AS topics_other_type_n,
      count(*) FILTER (WHERE emotion IS NOT NULL)::int AS emotion_nonnull_n
    FROM mentions WHERE project_id = ${PROJECT_ID}
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return reply({ error: 'HOLD_INVENTORY' }, 503);
  const counts: Record<string, number> = {};
  for (const field of countFields) {
    const raw = row[field];
    if (!(typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))))
      return reply({ error: 'HOLD_INVENTORY' }, 503);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) return reply({ error: 'HOLD_INVENTORY' }, 503);
    counts[field] = value;
  }
  return reply({ projectId: PROJECT_ID, counts, process: { pid: process.pid, nonce: processNonce } }, 200);
}
