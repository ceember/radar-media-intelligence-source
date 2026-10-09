import { sql } from 'drizzle-orm';
import { getDb, type DB } from '@/lib/db';
import { cleanStoredText } from './text-clean';
import type { AdObservationInput } from './competitor-ad-input';

export type AdObservation = AdObservationInput & { id: number; brandName: string; observedBy: number; createdAt: string };
export async function saveAdObservation(projectId: number, userId: number, input: AdObservationInput, db?: DB) {
  const rows = (await (db ?? await getDb()).execute(sql`INSERT INTO competitor_ad_observations
    (project_id,benchmark_id,brand_name,brand_domain,observed_by,checked_date,platform,ad_count,message_offer,landing_url,note)
    SELECT ${projectId},b.id,b.name,${input.domain},${userId},${input.checkedDate}::date,${input.platform},${input.adCount},
      ${input.messageOffer},${input.landingUrl},${input.note} FROM benchmark_entities b WHERE b.id=${input.benchmarkId} AND b.project_id=${projectId} RETURNING id`)).rows;
  return rows[0]?.id ? Number(rows[0].id) : null;
}
export async function adObservationHistory(projectId: number, db?: DB): Promise<AdObservation[]> {
  const rows = (await (db ?? await getDb()).execute(sql`SELECT * FROM (
    SELECT id,benchmark_id AS "benchmarkId",brand_name AS "brandName",brand_domain AS domain,observed_by AS "observedBy",
      checked_date::text AS "checkedDate",platform,ad_count AS "adCount",message_offer AS "messageOffer",landing_url AS "landingUrl",note,
      created_at AS "createdAt",row_number() OVER(PARTITION BY benchmark_id ORDER BY checked_date DESC,id DESC) AS position
    FROM competitor_ad_observations WHERE project_id=${projectId}) scoped WHERE position<=20 ORDER BY "benchmarkId","checkedDate" DESC,id DESC`)).rows;
  return rows.map(r => ({ ...r, brandName: cleanStoredText(String(r.brandName), 120), createdAt: new Date(r.createdAt as string).toISOString() })) as AdObservation[];
}
