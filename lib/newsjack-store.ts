import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb, type DB } from './db';
import { benchmarkEntities, mentions, newsjackProfiles, newsjackRuns } from './db/schema';
import type { NewsjackMode, NewsjackProfile, NewsjackSavedRun, NewsjackStory } from './newsjack-types';
import { cleanStoredText } from './text-clean';
import { researchPublicUrl } from './tavily-research';
import type {PlanningMode} from './newsjack-planning-types';

export function newsjackReservationSql(projectId: number, userId: number, mode: NewsjackMode|PlanningMode, input: string, calls:1|2=mode==='review'?2:1) {
  const table=['crisis','calendar','coverage','journalists'].includes(mode)?sql.identifier('newsjack_planning_runs'):sql.identifier('newsjack_runs');
  return sql`WITH slot AS (
    INSERT INTO newsjack_daily_usage(utc_day,run_count) VALUES((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,${calls})
    ON CONFLICT(utc_day) DO UPDATE SET run_count=newsjack_daily_usage.run_count+EXCLUDED.run_count
    WHERE newsjack_daily_usage.run_count+EXCLUDED.run_count <= 30 RETURNING run_count
  ) INSERT INTO ${table}(project_id,user_id,mode,input)
    SELECT ${projectId},${userId},${mode},${input} FROM slot RETURNING id`;
}
export async function reserveNewsjack(projectId:number,userId:number,mode:NewsjackMode|PlanningMode,input:string,db?:DB,calls?:1|2) {
  const result=await (db??await getDb()).execute(newsjackReservationSql(projectId,userId,mode,input,calls));
  return result.rows[0] ? Number((result.rows[0] as {id:number}).id) : null;
}
export async function newsjackProfile(projectId:number, db?:DB): Promise<NewsjackProfile> {
  const database=db??await getDb();
  const [saved]=await database.select().from(newsjackProfiles).where(eq(newsjackProfiles.projectId,projectId)).limit(1);
  if(saved) return saved.profile;
  const competitors=await database.select({name:benchmarkEntities.name}).from(benchmarkEntities)
    .where(and(eq(benchmarkEntities.projectId,projectId),eq(benchmarkEntities.isOwnBrand,0))).limit(12);
  return {standing:'',topics:[],competitors:competitors.map(c=>cleanStoredText(c.name,100)),proofAssets:[],spokespeople:[]};
}
export async function saveNewsjackProfile(projectId:number,profile:NewsjackProfile,db?:DB) {
  return (db??await getDb()).insert(newsjackProfiles).values({projectId,profile}).onConflictDoUpdate({target:newsjackProfiles.projectId,set:{profile,updatedAt:new Date()}});
}
export async function newsjackStories(projectId:number, db?:DB):Promise<NewsjackStory[]> {
  const rows=await (db??await getDb()).select().from(mentions).where(and(eq(mentions.projectId,projectId),eq(mentions.kind,'article'),
    inArray(mentions.source,['rss','googlenews','gdelt','newsapi']),gte(mentions.publishedAt,new Date(Date.now()-48*3_600_000))))
    .orderBy(desc(mentions.publishedAt)).limit(120);
  return rows.flatMap(row=>{const url=researchPublicUrl(row.url);return url ? [{id:row.id,title:cleanStoredText(row.title??'Untitled Story',300),
    text:cleanStoredText(row.articleText??row.content,3000),url,source:cleanStoredText(row.source,100),publishedAt:row.publishedAt.toISOString()}] : []});
}
export function serializeNewsjackRun(row:typeof newsjackRuns.$inferSelect):NewsjackSavedRun {return {...row,createdAt:row.createdAt.toISOString()};}
export async function newsjackHistory(projectId:number,mode:NewsjackMode, db?:DB) {
  const rows=await (db??await getDb()).select().from(newsjackRuns).where(and(eq(newsjackRuns.projectId,projectId),eq(newsjackRuns.mode,mode)))
    .orderBy(desc(newsjackRuns.createdAt)).limit(15);
  return rows.map(serializeNewsjackRun);
}
export async function savedNewsjackRun(projectId:number,id:number,db?:DB) {
  const [row]=await (db??await getDb()).select().from(newsjackRuns).where(and(eq(newsjackRuns.projectId,projectId),eq(newsjackRuns.id,id))).limit(1);
  return row ? serializeNewsjackRun(row) : null;
}
