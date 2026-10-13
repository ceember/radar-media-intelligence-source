import {createHash} from 'node:crypto';
import {and,desc,eq,gte,inArray,isNull,sql} from 'drizzle-orm';
import {getDb,type DB} from './db';
import {mentions,newsjackCoverageConfig,newsjackPlanningRuns} from './db/schema';
import {researchPublicUrl} from './tavily-research';
import {cleanStoredText} from './text-clean';
import {isOpaqueRedirect} from './article-text';
import type {CoverageConfig,CoverageDecision,PlanningMode,PlanningRun} from './newsjack-planning-types';
import type {NewsjackResult,NewsjackStory} from './newsjack-types';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const coverageConfigHash=(config:CoverageConfig)=>hash(JSON.stringify(config));
export function coverageUrlHash(value:string){const url=new URL(value);url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_|^(?:fbclid|gclid)$/i.test(key))url.searchParams.delete(key);url.searchParams.sort();return hash(url.href);}
export const serializePlanningRun=(row:typeof newsjackPlanningRuns.$inferSelect):PlanningRun=>({...row,createdAt:row.createdAt.toISOString()});
export async function planningHistory(projectId:number,mode:PlanningMode,db?:DB){return (await (db??await getDb()).select().from(newsjackPlanningRuns).where(and(eq(newsjackPlanningRuns.projectId,projectId),eq(newsjackPlanningRuns.mode,mode))).orderBy(desc(newsjackPlanningRuns.createdAt)).limit(15)).map(serializePlanningRun);}
export async function savedPlanningRun(projectId:number,id:number,db?:DB){const [row]=await (db??await getDb()).select().from(newsjackPlanningRuns).where(and(eq(newsjackPlanningRuns.projectId,projectId),eq(newsjackPlanningRuns.id,id))).limit(1);return row?serializePlanningRun(row):null;}
export async function savePlanningResult(projectId:number,userId:number,mode:PlanningMode,input:string,result:NewsjackResult,db?:DB){const [row]=await (db??await getDb()).insert(newsjackPlanningRuns).values({projectId,userId,mode,input,result,status:result.blocks[0]?.title.startsWith('STOP')?'needs-counsel':'complete'}).returning();return serializePlanningRun(row);}
export async function coverageConfig(projectId:number,db?:DB):Promise<CoverageConfig|null>{const [row]=await (db??await getDb()).select().from(newsjackCoverageConfig).where(eq(newsjackCoverageConfig.projectId,projectId)).limit(1);return row?.config??null;}
export async function saveCoverageConfig(projectId:number,config:CoverageConfig,db?:DB){await (db??await getDb()).insert(newsjackCoverageConfig).values({projectId,config}).onConflictDoUpdate({target:newsjackCoverageConfig.projectId,set:{config,updatedAt:new Date()}});}
export async function coverageCandidates(projectId:number,config:CoverageConfig,db?:DB):Promise<{stories:NewsjackStory[];known:number;total:number}>{
 const database=db??await getDb(),rows=await database.select().from(mentions).where(and(eq(mentions.projectId,projectId),eq(mentions.kind,'article'),isNull(mentions.importFileId),inArray(mentions.source,['rss','googlenews','gdelt','newsapi','newsdata']),gte(mentions.publishedAt,new Date(Date.now()-14*86_400_000)))).orderBy(desc(mentions.publishedAt)).limit(120);
 const seen=await database.execute(sql`SELECT url_hash FROM newsjack_coverage_decisions WHERE project_id=${projectId} AND config_hash=${coverageConfigHash(config)}`),knownHashes=new Set(seen.rows.map(row=>String((row as {url_hash:string}).url_hash))),unique=new Set<string>();
 const stories:NewsjackStory[]= [];let known=0,total=0;
 for(const row of rows){const url=researchPublicUrl(row.url),title=cleanStoredText(row.title??'Untitled Story',300),text=cleanStoredText(row.articleText??row.content,5000);if(!url||isOpaqueRedirect(url)||!(title+' '+text).toLowerCase().includes(config.keyword.toLowerCase()))continue;const key=coverageUrlHash(url);if(unique.has(key))continue;unique.add(key);total++;if(knownHashes.has(key)){known++;continue;}if(stories.length<4)stories.push({id:row.id,url,title,text,publishedAt:row.publishedAt.toISOString(),source:row.source});}
 return {stories,known,total};
}
/** Dedupe and alert insertion are one statement; concurrent runs/config edits cannot duplicate an alert. */
export async function recordCoverage(projectId:number,config:CoverageConfig,decision:CoverageDecision,db?:DB){
 const key=coverageUrlHash(decision.url),context={explanation:decision.reason,topics:[config.keyword],bySource:[],keyMentions:[{title:decision.title,url:decision.url,source:'rss',sentiment:'neutral'}]};
 const response=await (db??await getDb()).execute(sql`WITH recorded AS (
  INSERT INTO newsjack_coverage_decisions(project_id,config_hash,url_hash,decision) VALUES(${projectId},${coverageConfigHash(config)},${key},${JSON.stringify(decision)}::jsonb)
  ON CONFLICT(project_id,config_hash,url_hash) DO NOTHING RETURNING id
 ), first_feature AS (
  INSERT INTO newsjack_coverage_alerted(project_id,url_hash) SELECT ${projectId},${key} FROM recorded WHERE ${decision.alert}
  ON CONFLICT(project_id,url_hash) DO NOTHING RETURNING project_id
 ), new_alert AS (
  INSERT INTO alerts(project_id,type,severity,message,data) SELECT ${projectId},'newsjack_coverage','media',${cleanStoredText('New Coverage: '+decision.title,400)},${JSON.stringify(context)}::jsonb FROM first_feature RETURNING id
 ) SELECT (SELECT count(*) FROM recorded)::int AS recorded,(SELECT count(*) FROM new_alert)::int AS alerts`);
 return response.rows[0] as {recorded:number;alerts:number};
}
