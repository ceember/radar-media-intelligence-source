import {and,desc,eq,sql} from 'drizzle-orm';
import {getDb,type DB} from './db';
import {newsjackVisibilityRuns} from './db/schema';
import type {VisibilityRun} from './newsjack-visibility-types';

const serialize=(row:typeof newsjackVisibilityRuns.$inferSelect):VisibilityRun=>({...row,createdAt:row.createdAt.toISOString()});
export async function visibilityHistory(projectId:number,db?:DB){
 return (await (db??await getDb()).select().from(newsjackVisibilityRuns).where(eq(newsjackVisibilityRuns.projectId,projectId)).orderBy(desc(newsjackVisibilityRuns.createdAt)).limit(15)).map(serialize);
}
export async function savedVisibility(projectId:number,id:number,db?:DB){
 const [row]=await (db??await getDb()).select().from(newsjackVisibilityRuns).where(and(eq(newsjackVisibilityRuns.projectId,projectId),eq(newsjackVisibilityRuns.id,id))).limit(1);
 return row?serialize(row):null;
}
export async function reserveVisibility(projectId:number,userId:number,input:string,db?:DB){
 const response=await (db??await getDb()).execute(sql`WITH slot AS (
  INSERT INTO newsjack_daily_usage(utc_day,run_count) VALUES((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,1)
  ON CONFLICT(utc_day) DO UPDATE SET run_count=newsjack_daily_usage.run_count+1
  WHERE newsjack_daily_usage.run_count<30 RETURNING run_count
 ) INSERT INTO newsjack_visibility_runs(project_id,user_id,input) SELECT ${projectId},${userId},${input} FROM slot RETURNING id`);
 return response.rows[0]?Number((response.rows[0] as {id:number}).id):null;
}
