import { sql } from 'drizzle-orm';
import { getDb, type DB } from '@/lib/db';
import { fetchPublicArchiveIndex, validatePublicUrl } from '@/lib/public-http';
import { withinResearchDeadline } from '@/lib/web-research';
import { selectedCompetitorPages } from '@/lib/competitor-snapshots';
import { selectedPublicUrl } from '@/lib/competitor-page';
import { performance } from 'node:perf_hooks';

export type ArchiveRecord = { timestamp: string; archivedAt: string; originalUrl: string; mimeType: string; statusCode: string; replayUrl: string };
export type ArchiveFailureCategory = 'http' | 'timeout' | 'connection' | 'dns' | 'size' | 'encoding' | 'parse' | 'redirect' | 'guard' | 'interrupted' | 'quota' | 'unknown';
type ArchiveDiagnostic = { category: ArchiveFailureCategory; httpStatusClass: string | null; elapsedMs: number | null; transportElapsedMs: number | null };
export type ArchiveLookup = { id: number; pageId: number; sourceUrl: string; checkedAt: string; status: string; records: ArchiveRecord[] | null; message: string;
  failureCategory?: ArchiveFailureCategory | null; httpStatusClass?: string | null; elapsedMs?: number | null; transportElapsedMs?: number | null;
  backgroundStartedAt?: string | null; completedAt?: string | null };
export const ARCHIVE_RUNNING_MESSAGE = 'Checking the archive, this can take a few minutes';
export const ARCHIVE_BACKGROUND_BUDGET = 240_000;
export type ArchiveJob = { id: number; projectId: number; pageId: number; sourceUrl: string };
type ArchiveStart = { status: number; id?: number; cached?: boolean; message?: string; error?: string; job?: ArchiveJob };
const effectiveStatus = sql`CASE WHEN status='running' AND checked_at<now()-interval '270 seconds' THEN 'unknown' ELSE status END`;
const columns = ['timestamp', 'original', 'mimetype', 'statuscode'];
// CDX exact matching canonicalizes www and a trailing path slash. Keep the original URL in evidence/replay links.
const archiveHost=(url:URL)=>url.hostname.replace(/^www\./,'');
const archivePath=(url:URL)=>url.pathname.length>1?url.pathname.replace(/\/$/,''):url.pathname;
export function archiveEndpoint(sourceUrl: string) {
  const source = selectedPublicUrl(sourceUrl);
  if (source.includes('*')) throw Error('Choose an exact public page URL without wildcards.');
  const endpoint = new URL('https://web.archive.org/cdx/search/cdx');
  // Exact matching is CDX's default. Use the currently proven public query shape, without legacy optional flags.
  for (const [key,value] of Object.entries({ url: source.slice('https://'.length),output:'json',fl:columns.join(','),limit:'-30',fastLatest:'true' })) endpoint.searchParams.set(key,value);
  endpoint.searchParams.append('filter','statuscode:200');endpoint.searchParams.append('filter','mimetype:text/html');
  return endpoint.href;
}
/** Metadata only. Never fetch, embed or execute a replay page. Reject mismatched or malformed evidence. */
export function readArchiveIndex(text: string, sourceUrl: string): ArchiveRecord[] {
  if (Buffer.byteLength(text)>100_000) throw Error('Archive metadata exceeded its bound.');
  let data:unknown;try{data=JSON.parse(text);}catch{throw Error('Archive returned malformed JSON metadata.');}
  const requested = new URL(selectedPublicUrl(sourceUrl));
  if (!Array.isArray(data) || data.length>31) throw Error('Archive returned an invalid or oversized index.');
  if (!data.length) return [];
  if (!Array.isArray(data[0]) || data[0].length!==columns.length || !columns.every(key=>data[0].includes(key)) || new Set(data[0]).size!==columns.length)
    throw Error('Archive returned unexpected metadata fields.');
  const header: string[] = data[0], records: ArchiveRecord[] = [], seen = new Set<string>();
  for (const row of data.slice(1)) {
    if (!Array.isArray(row) || row.length!==columns.length || !row.every(v=>typeof v==='string' && v.length<=2000 && v.isWellFormed() && !/[\x00-\x20\x7f]/.test(v)))
      throw Error('Archive returned malformed metadata.');
    const timestamp=row[header.indexOf('timestamp')], originalUrl=row[header.indexOf('original')], mimeType=row[header.indexOf('mimetype')],statusCode=row[header.indexOf('statuscode')];
    if (!/^\d{14}$/.test(timestamp) || mimeType!=='text/html' || statusCode!=='200') throw Error('Archive returned unsupported capture metadata.');
    const iso=`${timestamp.slice(0,4)}-${timestamp.slice(4,6)}-${timestamp.slice(6,8)}T${timestamp.slice(8,10)}:${timestamp.slice(10,12)}:${timestamp.slice(12,14)}Z`,date=new Date(iso);
    if (!Number.isFinite(date.getTime()) || date.toISOString().replace(/[-:TZ.]/g,'').slice(0,14)!==timestamp || date.getTime()>Date.now())
      throw Error('Archive returned an invalid capture timestamp.');
    const original = new URL(originalUrl);
    if (!['http:','https:'].includes(original.protocol) || original.username || original.password || original.port || original.hash ||
      archiveHost(original)!==archiveHost(requested) || archivePath(original)!==archivePath(requested) || original.search!==requested.search)
      throw Error('Archive returned a capture for a different public page.');
    if (!seen.has(timestamp+'\n'+original.href)) records.push({timestamp,archivedAt:date.toISOString(),originalUrl:original.href,mimeType,statusCode,replayUrl:`https://web.archive.org/web/${timestamp}/${original.href}`});
    seen.add(timestamp+'\n'+original.href);
  }
  return records.sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
}
export function archivePageIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length>5 || value.some(id=>!Number.isSafeInteger(id) || id<1) || new Set(value).size!==value.length)
    throw Error('Select up to five distinct public pages.');
  return value;
}
export async function archiveSelection(projectId: number, db?: DB): Promise<number[]> {
  const row=(await (db??await getDb()).execute(sql`SELECT page_ids FROM competitor_archive_selection WHERE project_id=${projectId}`)).rows[0];
  return archivePageIds(row?.page_ids??[]);
}
export async function selectArchivePages(projectId: number, ids: number[], db?: DB) {
  const selected=archivePageIds(ids), database=db??await getDb(), pages=await selectedCompetitorPages(projectId,database);
  if (selected.some(id=>!pages.some(p=>p.id===id))) return {status:404,error:'Selected page not found in this project.'};
  await database.execute(sql`INSERT INTO competitor_archive_selection(project_id,page_ids) VALUES(${projectId},${JSON.stringify(selected)}::jsonb)
    ON CONFLICT(project_id) DO UPDATE SET page_ids=EXCLUDED.page_ids,selected_at=now()`);
  return {status:200,message:'Archive pages selected. No provider lookup made.'};
}
export async function archiveHistory(projectId: number, db?: DB): Promise<ArchiveLookup[]> {
  const rows=(await (db??await getDb()).execute(sql`SELECT DISTINCT ON(page_id,source_url) id,page_id AS "pageId",source_url AS "sourceUrl",checked_at AS "checkedAt",${effectiveStatus} AS status,records,
    CASE WHEN status='running' AND checked_at<now()-interval '270 seconds' THEN 'Archive lookup interrupted; no completed index recorded. Archive history Unknown. Try again later.' ELSE message END AS message,
    CASE WHEN status='running' AND checked_at<now()-interval '270 seconds' THEN 'interrupted' ELSE failure_category END AS "failureCategory",
    CASE WHEN status='running' AND checked_at<now()-interval '270 seconds' THEN NULL ELSE http_status_class END AS "httpStatusClass",
    CASE WHEN status='running' AND checked_at<now()-interval '270 seconds' THEN NULL ELSE elapsed_ms END AS "elapsedMs",
    CASE WHEN status='running' AND checked_at<now()-interval '270 seconds' THEN NULL ELSE transport_elapsed_ms END AS "transportElapsedMs",
    background_started_at AS "backgroundStartedAt",
    CASE WHEN status='running' AND checked_at<now()-interval '270 seconds' THEN NULL ELSE completed_at END AS "completedAt"
    FROM competitor_archive_lookups WHERE project_id=${projectId} ORDER BY page_id,source_url,checked_at DESC,id DESC`)).rows;
  return rows.map(row=>({...row,checkedAt:new Date(row.checkedAt as string).toISOString(),
    message:row.message==='Archive is slow, try again. The index exceeded its four-minute background budget; history remains Unknown. Wait ten minutes before another attempt.'
      ?'Archive lookup timed out or reached its work deadline. Actual elapsed time was not recorded. Archive history Unknown.':row.message,
    backgroundStartedAt:row.backgroundStartedAt?new Date(row.backgroundStartedAt as string).toISOString():null,
    completedAt:row.completedAt?new Date(row.completedAt as string).toISOString():null})) as ArchiveLookup[];
}
export function archiveFailureDiagnostic(error: unknown): { category: ArchiveFailureCategory; httpStatusClass: string | null; message: string } {
  const message=error instanceof Error?error.message:'';
  const code=(error as NodeJS.ErrnoException | null)?.code;
  const failure=(category:ArchiveFailureCategory,text:string,httpStatusClass:string|null=null)=>({category,httpStatusClass,message:text});
  if(['Public HTTP timeout','Public DNS timeout','Research reached its time limit.','Research reached its time limit. Try a narrower question.','Archive request budget reached.'].includes(message)
    ||code==='ETIMEDOUT'||code==='ERR_TLS_HANDSHAKE_TIMEOUT')
    return failure(message==='Public DNS timeout'?'dns':'timeout','Archive is slow, try again. '+(message==='Public DNS timeout'?'DNS lookup timed out.':'The lookup reached a timeout or its remaining work deadline.')+' History remains Unknown. Wait ten minutes before another attempt.');
  const http=/^Public HTTP status (\d{3})$/.exec(message);
  if(http){
    const status=Number(http[1]),httpStatusClass=status>=100&&status<600?`${Math.floor(status/100)}xx`:'other';
    if(status===429)return failure('http','Rate limited by Internet Archive. Archive history Unknown; no retry was made. Try on a later day.',httpStatusClass);
    if(status===400)return failure('http','Internet Archive rejected the index query (HTTP 400). Archive history Unknown; no automatic retry.',httpStatusClass);
    return failure('http',`Internet Archive returned HTTP ${http[1]}. Archive history Unknown; no automatic retry.`,httpStatusClass);
  }
  const transport:Record<string,{category:ArchiveFailureCategory;text:string}>={
    'Public HTTP encoding refused':{category:'encoding',text:'Archive response encoding was unsupported.'},
    'Public HTTP body too large':{category:'size',text:'Archive metadata exceeded the 100 KB input bound.'},
    'Archive metadata exceeded its bound.':{category:'size',text:'Archive metadata exceeded the 100 KB input bound.'},
    'Too many public HTTP redirects':{category:'redirect',text:'Archive index redirected; no redirect or replay was followed.'},
    'Public HTTP redirect invalid':{category:'redirect',text:'Archive index returned an invalid redirect; none was followed.'},
    'Non-public or unresolved HTTP target':{category:'dns',text:'Archive index DNS did not resolve to an allowed public address.'},
    'Public archive index target invalid':{category:'guard',text:'Archive index target was refused by the public-target guard.'},
    'Public HTTP target invalid':{category:'guard',text:'Archive index target was refused by the public-target guard.'},
  };
  if(Object.hasOwn(transport,message))return failure(transport[message].category,transport[message].text+' Archive history Unknown; no automatic retry.');
  if(code&&['ECONNRESET','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','EAI_AGAIN','ENOTFOUND'].includes(code))
    return failure(['EAI_AGAIN','ENOTFOUND'].includes(code)?'dns':'connection','Archive connection unavailable ('+code+'). Archive history Unknown; no automatic retry.');
  if(['Archive returned malformed JSON metadata.','Archive returned an invalid or oversized index.','Archive returned unexpected metadata fields.',
    'Archive returned malformed metadata.','Archive returned unsupported capture metadata.','Archive returned an invalid capture timestamp.',
    'Archive returned a capture for a different public page.','Archive returned no JSON metadata.','Archive metadata parse failed.'].includes(message))
    return failure('parse','Archive returned invalid or mismatched JSON metadata. Archive history Unknown; no automatic retry.');
  return failure('unknown','Archive index unavailable. Archive history Unknown; no completed index was obtained and no automatic retry was made.');
}
export function archiveFailureMessage(error: unknown) {
  return archiveFailureDiagnostic(error).message;
}
export async function startArchiveLookup(projectId: number,pageId: number,deadline=Date.now()+15_000): Promise<ArchiveStart> {
  const wait=<T>(value:PromiseLike<T>)=>withinResearchDeadline(value,deadline),db=await wait(getDb());
  const selection=await wait(archiveSelection(projectId,db)),page=(await wait(selectedCompetitorPages(projectId,db))).find(p=>p.id===pageId);
  if (!page || !selection.includes(pageId)) return {status:404,error:'Choose one of this project’s selected archive pages.'};
  const sourceUrl=selectedPublicUrl(page.url);archiveEndpoint(sourceUrl);
  const cached=(await wait(db.execute(sql`SELECT id FROM competitor_archive_lookups WHERE project_id=${projectId} AND page_id=${pageId} AND source_url=${sourceUrl}
    AND status='ok' AND checked_at>now()-interval '24 hours' ORDER BY checked_at DESC,id DESC LIMIT 1`))).rows[0];
  if(cached)return {status:200,id:Number(cached.id),cached:true,message:'Archive index cached for 24 hours; no provider request.'};
  const recent=(await wait(db.execute(sql`SELECT id,${effectiveStatus} AS status FROM competitor_archive_lookups WHERE project_id=${projectId} AND page_id=${pageId} AND source_url=${sourceUrl}
    AND checked_at>now()-interval '10 minutes' ORDER BY checked_at DESC,id DESC LIMIT 1`))).rows[0];
  if(recent?.status==='running')return {status:202,id:Number(recent.id),message:ARCHIVE_RUNNING_MESSAGE};
  if(recent)return {status:200,id:Number(recent.id),message:'A recent archive attempt exists. Inspect the saved status; no automatic retry. Wait ten minutes before another attempt.'};
  // Validate the chosen public target before sending its URL to the fixed archive index host.
  await wait(validatePublicUrl(sourceUrl));
  // A prior crashed callback must not hold the unique claim indefinitely. Only this authorized start writes.
  await wait(db.execute(sql`UPDATE competitor_archive_lookups SET status='unknown',records=NULL,failure_category='interrupted',
    http_status_class=NULL,elapsed_ms=NULL,transport_elapsed_ms=NULL,completed_at=NULL,
    message='Archive lookup interrupted; no completed index recorded. Archive history Unknown. Try again later.'
    WHERE project_id=${projectId} AND page_id=${pageId} AND source_url=${sourceUrl} AND status='running' AND checked_at<now()-interval '270 seconds'`));
  // The route retains this promise through after() if the reservation finishes after its response deadline.
  const reservation=await db.execute(sql`WITH eligible AS (
    SELECT p.id,p.url FROM competitor_pages p JOIN competitor_archive_selection a ON a.project_id=p.project_id
    WHERE p.project_id=${projectId} AND p.id=${pageId} AND p.url=${sourceUrl} AND a.page_ids @> jsonb_build_array(p.id)
      AND NOT EXISTS(SELECT 1 FROM competitor_archive_lookups l WHERE l.project_id=p.project_id AND l.page_id=p.id AND l.source_url=p.url AND l.checked_at>now()-interval '10 minutes')),claim AS (
    INSERT INTO competitor_archive_lookups(project_id,page_id,source_url,status,message)
    SELECT ${projectId},id,url,'running',${ARCHIVE_RUNNING_MESSAGE} FROM eligible
    ON CONFLICT(project_id,page_id,source_url) WHERE status='running' DO NOTHING RETURNING id),slot AS (
    INSERT INTO competitor_archive_usage(project_id,utc_day,attempts) SELECT ${projectId},(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,1 FROM claim
    ON CONFLICT(project_id,utc_day) DO UPDATE SET attempts=competitor_archive_usage.attempts+1 WHERE competitor_archive_usage.attempts<10 RETURNING attempts)
    SELECT claim.id,slot.attempts FROM claim LEFT JOIN slot ON true`);
  const reserved=reservation.rows[0],id=reserved?.id;
  if(!id){
    // Use a new statement snapshot: ON CONFLICT can see an overlapping winner invisible to its original snapshot.
    const winner=(await db.execute(sql`SELECT id FROM competitor_archive_lookups WHERE project_id=${projectId} AND page_id=${pageId} AND source_url=${sourceUrl}
      AND checked_at>now()-interval '10 minutes' ORDER BY checked_at DESC,id DESC LIMIT 1`)).rows[0];
    if(winner)return {status:202,id:Number(winner.id),message:ARCHIVE_RUNNING_MESSAGE};
  }
  if(id&&!reserved.attempts){
    await failArchiveLookup({id:Number(id),projectId,pageId,sourceUrl},'Daily archive lookup cap reached; no provider was called. Resets at midnight UTC.',Date.now()+5000,
      {category:'quota',httpStatusClass:null,elapsedMs:null,transportElapsedMs:null});
    return {status:429,error:'Ten lookup attempts used today. The cap resets at midnight UTC. Failures count.'};
  }
  if(!id)return {status:429,error:'Archive selection changed or ten lookup attempts used today. Reload; the attempt cap resets at midnight UTC. Failures count.'};
  return {status:202,id:Number(id),message:ARCHIVE_RUNNING_MESSAGE,job:{id:Number(id),projectId,pageId,sourceUrl}};
}

/** Read-only status polls never reserve slots, fetch providers or mutate another user's project. */
export async function archiveStatuses(projectId:number,ids:number[],db?:DB) {
  const rows=(await (db??await getDb()).execute(sql`SELECT id,${effectiveStatus} AS status FROM competitor_archive_lookups
    WHERE project_id=${projectId} AND id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)})`)).rows;
  return rows.map(row=>({id:Number(row.id),status:String(row.status)}));
}

export async function failArchiveLookup(job:ArchiveJob,message:string,deadline=Date.now()+5000,
  diagnostic:ArchiveDiagnostic={category:'interrupted',httpStatusClass:null,elapsedMs:null,transportElapsedMs:null}) {
  const db=await withinResearchDeadline(getDb(),deadline);
  await withinResearchDeadline(db.execute(sql`UPDATE competitor_archive_lookups SET status='unknown',records=NULL,message=${message},
    failure_category=${diagnostic.category},http_status_class=${diagnostic.httpStatusClass},elapsed_ms=${diagnostic.elapsedMs},
    transport_elapsed_ms=${diagnostic.transportElapsedMs},completed_at=now()
    WHERE id=${job.id} AND project_id=${job.projectId} AND page_id=${job.pageId} AND source_url=${job.sourceUrl} AND status='running'`),deadline);
}

/** Runs only in the route's after() callback; transport, parsing and final storage share this budget. */
export async function finishArchiveLookup(job:ArchiveJob,deadline=Date.now()+ARCHIVE_BACKGROUND_BUDGET) {
  const {id,projectId,pageId,sourceUrl}=job;
  const started=performance.now(),startedAt=new Date().toISOString();
  const elapsed=()=>Math.round(Math.max(0,performance.now()-started));
  let transportElapsedMs:number|null=null;
  let outcome:ArchiveFailureCategory|'ok'|'not-running'='not-running';
  const saveMargin=Math.min(5000,Math.max(20,Math.floor((deadline-Date.now())/10))),workDeadline=deadline-saveMargin;
  const wait=<T>(value:PromiseLike<T>)=>withinResearchDeadline(value,workDeadline);
  try {
    const db=await wait(getDb());
    const pending=(await wait(db.execute(sql`UPDATE competitor_archive_lookups SET background_started_at=COALESCE(background_started_at,${startedAt}::timestamptz)
      WHERE id=${id} AND project_id=${projectId} AND page_id=${pageId} AND source_url=${sourceUrl} AND status='running' RETURNING id`))).rows[0];
    if(!pending)return;
    const transportStarted=performance.now();
    const response=await wait(fetchPublicArchiveIndex(archiveEndpoint(sourceUrl),{timeoutMs:Math.max(1,Math.min(ARCHIVE_BACKGROUND_BUDGET,workDeadline-Date.now()-1)),headers:{Accept:'application/json'}})
      .finally(()=>{transportElapsedMs=Math.round(Math.max(0,performance.now()-transportStarted));
        console.info('[archive] Guarded fetch settled',JSON.stringify({lookupId:id,elapsedMs:transportElapsedMs}));}));
    if(!/^application\/json\b/i.test(response.contentType))throw Error('Archive returned no JSON metadata.');
    let records:ArchiveRecord[];
    try{records=readArchiveIndex(response.text,sourceUrl);}catch(error){
      if(error instanceof Error&&error.message==='Archive metadata exceeded its bound.')throw error;
      throw Error('Archive metadata parse failed.');
    }
    const message=records.length?'Dated archive links saved. This is a limited index sample, not a complete history.':'No matching HTML archive found in this completed index query. This does not prove the page was never archived.';
    const saved=await wait(db.execute(sql`UPDATE competitor_archive_lookups SET status='ok',records=${JSON.stringify(records)}::jsonb,checked_at=now(),message=${message},
      failure_category=NULL,http_status_class=NULL,elapsed_ms=${elapsed()},transport_elapsed_ms=${transportElapsedMs},completed_at=now()
      WHERE id=${id} AND project_id=${projectId} AND page_id=${pageId} AND source_url=${sourceUrl} AND status='running' AND clock_timestamp()<${new Date(workDeadline).toISOString()}::timestamptz RETURNING id`));
    if(!saved.rows.length)throw Error('Archive request budget reached.');
    outcome='ok';
  }catch(error){
    const failure=archiveFailureDiagnostic(error);
    outcome=failure.category;
    try{await failArchiveLookup(job,failure.message,deadline,{...failure,elapsedMs:elapsed(),transportElapsedMs});}catch{console.error('[archive] Failed to finalize background lookup');}
    // A crashed invocation is displayed as Unknown after 270s, without a write by a shared reader.
  }finally{console.info('[archive] Background callback finished',JSON.stringify({lookupId:id,outcome,elapsedMs:elapsed(),transportElapsedMs}));}
}
