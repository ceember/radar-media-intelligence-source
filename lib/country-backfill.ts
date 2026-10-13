import 'server-only';
import { countryFromDomain, countryFromUrl } from './country-codes';

export async function backfillCountries(projectId: number, limit = 25000): Promise<number> {
  const { getDb } = await import('@/lib/db');
  const { sql } = await import('drizzle-orm');
  const db = await getDb();
  const rows = (await db.execute(sql`
    SELECT id, url, author FROM mentions
    WHERE project_id = ${projectId} AND country IS NULL
      AND ((url IS NOT NULL AND url <> '') OR (author IS NOT NULL AND author <> ''))
    LIMIT ${limit}
  `)).rows as { id: number; url: string | null; author: string | null }[];
  if (!rows.length) return 0;
  const byCountry = new Map<string, number[]>();
  for (const row of rows) {
    const country = countryFromUrl(row.url) ?? countryFromDomain(row.author);
    if (!country) continue;
    (byCountry.get(country) ?? byCountry.set(country, []).get(country)!).push(row.id);
  }
  let done = 0;
  for (const [country, ids] of byCountry) {
    for (let offset = 0; offset < ids.length; offset += 500) {
      const chunk = ids.slice(offset, offset + 500);
      await db.execute(sql`
        UPDATE mentions SET country = ${country}
        WHERE id IN (${sql.join(chunk.map(id => sql`${id}`), sql`, `)})
      `);
      done += chunk.length;
    }
  }
  return done;
}
