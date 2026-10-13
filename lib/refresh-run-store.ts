import {sql} from 'drizzle-orm';
import {getDb,type DB} from './db';
import {refreshCountersSchema,type RefreshCounter} from './refresh-run-counters';

export type RefreshRun={id:number;projectId:number;trigger:'refresh'|'cron';status:'running'|'complete'|'failed';startedAt:string;finishedAt:string|null;counters:RefreshCounter[]};

export async function startRefreshRun(projectId:number,trigger:'refresh'|'cron',db?:DB):Promise<number>{
 const result=await (db??await getDb()).execute(sql`INSERT INTO refresh_runs(project_id,trigger) VALUES(${projectId},${trigger}) RETURNING id`);
 return Number(result.rows[0].id);
}

export async function finishRefreshRun(projectId:number,id:number,status:'complete'|'failed',counters:RefreshCounter[],db?:DB){
 const safe=refreshCountersSchema.parse(counters);
 await (db??await getDb()).execute(sql`UPDATE refresh_runs SET status=${status},counters=${JSON.stringify(safe)}::jsonb,finished_at=now() WHERE id=${id} AND project_id=${projectId} AND status='running'`);
}

export async function refreshRunsForViewer(projectId:number,admin:boolean,db?:DB):Promise<RefreshRun[]>{
 if(!admin)return [];
 const result=await (db??await getDb()).execute(sql`SELECT id,project_id,trigger,status,counters,started_at,finished_at FROM refresh_runs WHERE project_id=${projectId} ORDER BY started_at DESC,id DESC LIMIT 10`);
 return result.rows.map(row=>({id:Number(row.id),projectId:Number(row.project_id),trigger:row.trigger as RefreshRun['trigger'],status:row.status as RefreshRun['status'],counters:refreshCountersSchema.parse(row.counters),startedAt:new Date(String(row.started_at)).toISOString(),finishedAt:row.finished_at?new Date(String(row.finished_at)).toISOString():null}));
}
