import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { getDb } from './db';
import { benchmarkEntities, mentions } from './db/schema';
import { suggestText, TRIAGE_BATCH } from './text-triage';
import { withinResearchDeadline } from './web-research';
import type { TriageBatchResult } from './text-triage-types';

/** Shared by authorized manual/pipeline calls; never modifies AI/human labels. */
export async function triageProject(projectId: number): Promise<TriageBatchResult> {
  const deadline = Date.now() + 20_000;
  const wait = <T>(p: PromiseLike<T>) => withinResearchDeadline(p, deadline);
  let scanned = 0, writing = false;
  try {
    const db = await wait(getDb());
    const brands = await wait(db.select().from(benchmarkEntities).where(eq(benchmarkEntities.projectId, projectId))
      .orderBy(benchmarkEntities.id).limit(20));
    const pending = and(eq(mentions.projectId, projectId), or(isNull(mentions.textSuggestions),
      sql`${mentions.textSuggestions}->>'status' = 'abstained' AND ${mentions.textSuggestions}->>'review' = 'unreviewed'
        AND ${mentions.language} ~* '^(en([-_][a-z]{2})?|eng)$'`));
    const rows = await wait(db.select({ id: mentions.id, title: mentions.title, content: mentions.content,
      articleText: mentions.articleText, language: mentions.language }).from(mentions)
      .where(pending).orderBy(desc(mentions.publishedAt)).limit(TRIAGE_BATCH));
    let stoppedEarly = false;
    const updates = [];
    for (const m of rows) {
      // Leave one second for saving. Synchronous NLP cannot be preempted, so check again after it.
      if (Date.now() >= deadline - 1000) { stoppedEarly = true; break; }
      const suggestions = suggestText(`${m.title ?? ''}\n${m.articleText || m.content}`, m.language, brands);
      scanned++;
      if (Date.now() >= deadline) return { saved: 0, scanned, stoppedEarly: true };
      updates.push({ id: m.id, suggestions });
    }
    if (!updates.length) return { saved: 0, scanned, stoppedEarly };
    if (Date.now() >= deadline) return { saved: 0, scanned, stoppedEarly: true };
    writing = true;
    // Pending guard preserves concurrent human review. The DB clock also rejects a late queued write.
    const saved = await wait(db.execute(sql`UPDATE mentions m SET text_suggestions = u.suggestions
      FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS u(id integer, suggestions jsonb)
      WHERE m.id = u.id AND m.project_id = ${projectId} AND clock_timestamp() < ${new Date(deadline).toISOString()}::timestamptz
        AND (m.text_suggestions IS NULL OR (m.text_suggestions->>'status' = 'abstained'
        AND m.text_suggestions->>'review' = 'unreviewed' AND m.language ~* '^(en([-_][a-z]{2})?|eng)$')) RETURNING m.id`));
    return { saved: saved.rows.length, scanned, stoppedEarly };
  } catch (error) {
    if (Date.now() >= deadline) return { saved: writing ? null : 0, scanned, stoppedEarly: true };
    throw error;
  }
}
