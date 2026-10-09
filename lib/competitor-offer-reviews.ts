import { sql } from 'drizzle-orm';
import { getDb, type DB } from '@/lib/db';
import type { OfferReviewInput } from './competitor-offer-input';

export type OfferReview = OfferReviewInput & { id: number; reviewedBy: number; createdAt: string };
/** Append corrections beside the publisher evidence; never rewrite a snapshot or its automatic delta. */
export async function saveOfferReview(projectId: number, userId: number, input: OfferReviewInput, db?: DB) {
  const rows = (await (db ?? await getDb()).execute(sql`INSERT INTO competitor_offer_reviews
    (project_id,snapshot_id,offer_id,field,corrected_value,note,reviewed_by)
    SELECT ${projectId},s.id,${input.offerId},${input.field},${input.correctedValue},${input.note},${userId}
    FROM competitor_snapshots s WHERE s.id=${input.snapshotId} AND s.project_id=${projectId} AND s.status='ok'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.offers->'offers') o WHERE o->>'id'=${input.offerId}) RETURNING id`)).rows;
  return rows[0]?.id ? Number(rows[0].id) : null;
}
export async function offerReviewHistory(projectId: number, db?: DB): Promise<OfferReview[]> {
  const rows = (await (db ?? await getDb()).execute(sql`SELECT * FROM (
    SELECT id,snapshot_id AS "snapshotId",offer_id AS "offerId",field,corrected_value AS "correctedValue",note,
      reviewed_by AS "reviewedBy",created_at AS "createdAt",row_number() OVER(PARTITION BY snapshot_id,offer_id ORDER BY id DESC) AS position
    FROM competitor_offer_reviews WHERE project_id=${projectId}) scoped WHERE position<=10 ORDER BY id DESC`)).rows;
  return rows.map(r => ({ ...r, createdAt: new Date(r.createdAt as string).toISOString() })) as OfferReview[];
}
