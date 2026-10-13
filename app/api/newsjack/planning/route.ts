import {and,eq} from 'drizzle-orm';
import {getCurrentUser,userAiEnabled,isAdmin} from '@/lib/auth';
import {getCurrentProject} from '@/lib/data';
import {isDemoMode} from '@/lib/session';
import {researchCanWrite,researchSameOrigin} from '@/lib/web-research';
import {getDb} from '@/lib/db';
import {newsjackPlanningRuns} from '@/lib/db/schema';
import {callClaude,MODELS,aiStatus} from '@/lib/claude';
import {cleanStoredText} from '@/lib/text-clean';
import {publicBrandGuard} from '@/lib/newsjack';
import {newsjackProfile,reserveNewsjack} from '@/lib/newsjack-store';
import {readNewsjackSource} from '@/lib/newsjack-sources';
import {crisisSchema,crisisHolding} from '@/lib/newsjack-crisis';
import {calendarSchema,journalistSchema,coverageSchema,validateCalendar,planningResult,calendarClaims,calendarResult,planningPrompt,parsePlanningJudgement,journalistClaims,journalistResult,coverageClaims,coverageDecisions,hasStanceCandidates,PITCH_SLOP} from '@/lib/newsjack-planning';
import {coverageConfig,saveCoverageConfig,coverageCandidates,recordCoverage,savedPlanningRun,savePlanningResult} from '@/lib/newsjack-planning-store';
import {factStancePrompt} from '@/lib/newsjack-facts';
import type {PlanningMode} from '@/lib/newsjack-planning-types';
import type {NewsjackSource,NewsjackResult} from '@/lib/newsjack-types';
import {planningRunForViewer} from '@/lib/newsjack-planning-visibility';
import {parseReporterJudgement,reporterJsonSchema} from '@/lib/newsjack-reporter-contract';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
export async function POST(req:Request){
 let runId:number|null=null,projectId:number|null=null;
 try{
  if(!researchSameOrigin(req.headers.get('origin'),req.url,req.headers.get('host')))return Response.json({error:'Cross-site requests are not allowed.'},{status:403});
  if(!req.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Send JSON.'},{status:415});
  const user=await getCurrentUser();if(!user)return Response.json({error:'Sign in.'},{status:401});
  const project=await getCurrentProject();if(!project)return Response.json({error:'No accessible project.'},{status:404});
  if(isDemoMode()||!researchCanWrite(user,project))return Response.json({error:'Only the project owner or an admin can run or change Newsjack. Readers see saved results.'},{status:403});
  if(Number(req.headers.get('content-length'))>24_000)return Response.json({error:'Request too large.'},{status:400});
  const raw=await req.text();if(raw.length>24_000)return Response.json({error:'Request too large.'},{status:400});
  let body;try{body=JSON.parse(raw)}catch{return Response.json({error:'Invalid JSON.'},{status:400})}
  if(body?.projectId!==project.id)return Response.json({error:'Reload the current project.'},{status:409});
  if(body.publicOnly!==true)return Response.json({error:'Confirm that all material is public and approved for use.'},{status:400});
  if(!['crisis','calendar','coverage','journalists'].includes(body.mode))return Response.json({error:'Choose a Newsjack planning page.'},{status:400});
  projectId=project.id;const mode=body.mode as PlanningMode,now=new Date().toISOString();
  const schema=mode==='crisis'?crisisSchema:mode==='calendar'?calendarSchema:mode==='journalists'?journalistSchema:coverageSchema;
  if(mode==='coverage'&&body.action==='configure'){
   const config=coverageSchema.safeParse(body.input);if(!config.success)return Response.json({error:'Supply a bounded keyword, its meaning and exclusions.'},{status:400});
   publicBrandGuard(project.name,JSON.stringify(config.data));await saveCoverageConfig(project.id,config.data);return Response.json({config:config.data});
  }
  const parsed=mode==='coverage'?coverageSchema.safeParse(await coverageConfig(project.id)):schema.safeParse(body.input);
  if(!parsed.success)return Response.json({error:mode==='coverage'?'Save a keyword and its meaning first.':'Complete every required field, legal gate or single-approach acknowledgement, within the stated limits.'},{status:400});
  const input=cleanStoredText(JSON.stringify(parsed.data));publicBrandGuard(project.name,input);
  if(mode==='crisis'){
   const result=crisisHolding(crisisSchema.parse(parsed.data),now);
   publicBrandGuard(project.name,JSON.stringify(result));
   return Response.json({run:await savePlanningResult(project.id,user.id,mode,input,result)});
  }
  if(mode==='calendar')try{validateCalendar(calendarSchema.parse(parsed.data),now)}catch{return Response.json({error:'Range or unclear date, not checked. Use real dates inside the next six months and an exact allowlisted source quote naming both bounds for a range.'},{status:400})}
  if(mode==='journalists'&&PITCH_SLOP.test(journalistSchema.parse(parsed.data).pitch)){
   const result=planningResult();result.blocks.push({title:'No Pick — Pitch Not Ready',text:'Remove template placeholders, generic flattery and promotional language. Review the pitch before checking named reporters. No AI call or daily slot was used.',sourceIds:[]});
   return Response.json({run:await savePlanningResult(project.id,user.id,mode,input,result)});
  }
  const pool=mode==='coverage'?await coverageCandidates(project.id,coverageSchema.parse(parsed.data)):null;
  if(pool&&!pool.stories.length){const result=planningResult();result.blocks.push({title:'No New Coverage To Check',text:`${pool.total} matching collected articles in the last 14 days; ${pool.known} already judged. No AI call, daily slot or alert used. Configure this project's collection sources to discover more news. Manual checks do not schedule collection.`,sourceIds:[]});return Response.json({run:await savePlanningResult(project.id,user.id,mode,input,result)});}
  if(!userAiEnabled(user))return Response.json({error:'AI is not enabled for this account.'},{status:403});
  const profile=await newsjackProfile(project.id);publicBrandGuard(project.name,JSON.stringify(profile));
  const ai=await aiStatus();if(!ai.ready)return Response.json({error:ai.capReached?'AI spend cap reached.':'AI is not configured or enabled.'},{status:ai.capReached?429:503});
  const db=await getDb();runId=await reserveNewsjack(project.id,user.id,mode,input,db,mode==='calendar'?1:2);
  if(runId===null)return Response.json({error:'Newsjack daily limit reached (30 AI calls; this check reserves one calendar call or two fit/coverage calls). Resets at midnight UTC.'},{status:429});
  const urls=mode==='calendar'?calendarSchema.parse(parsed.data).entries.map(entry=>entry.url):mode==='journalists'?journalistSchema.parse(parsed.data).candidates.map(candidate=>candidate.url):pool!.stories.map(story=>story.url);
  const fetched=new Map<string,NewsjackSource>(),sources:NewsjackSource[]=[];
  for(const url of urls){if(!fetched.has(url))fetched.set(url,await readNewsjackSource(url,sources.length+1));sources.push({...fetched.get(url)!,id:sources.length+1});}
  for(const source of sources)publicBrandGuard(project.name,source.text);
  let judgement:string|null=null;
  if(mode!=='calendar'&&sources.some(source=>source.read)){
   const prompt=planningPrompt(mode,parsed.data,sources,now);judgement=await callClaude(MODELS.haiku,`newsjack_${mode}`,prompt.system,prompt.user,2200,false,30_000,mode==='journalists'?{name:'newsjack_reporter_fit',schema:reporterJsonSchema(sources)}:undefined);
  }
  const reporterParsed=mode==='journalists'?parseReporterJudgement(judgement,sources):null;
  const items=reporterParsed?.items??parsePlanningJudgement(judgement,sources),claims=mode==='calendar'?calendarClaims(calendarSchema.parse(parsed.data),sources):mode==='journalists'?journalistClaims(journalistSchema.parse(parsed.data),sources,items,now):coverageClaims(coverageSchema.parse(parsed.data),sources,items);
  let stance:string|null=null;
  if(hasStanceCandidates(claims,sources)){
   const prompt=factStancePrompt(claims,sources);
   try{stance=await callClaude(MODELS.haiku,'newsjack_planning_source_stance',prompt.system,prompt.user,500,false,20_000)}catch{console.warn('[newsjack-planning]',{reason:'stance_unavailable'});}
  }
  let result:NewsjackResult;
  if(mode==='calendar')result=calendarResult(calendarSchema.parse(parsed.data),sources,profile,now,stance);
  else if(mode==='journalists')result=journalistResult(journalistSchema.parse(parsed.data),sources,items,now,stance,reporterParsed!.diagnostic);
  else{
   const config=coverageSchema.parse(parsed.data),checked=coverageDecisions(config,sources,items,stance);result=planningResult(sources);result.claims=checked.claims;let alerts=0,recorded=0;
   for(const decision of checked.decisions){publicBrandGuard(project.name,JSON.stringify(decision));const saved=await recordCoverage(project.id,config,decision,db);alerts+=saved.alerts;recorded+=saved.recorded;result.blocks.push({title:`${decision.title} · ${decision.verdict.replaceAll('_',' ')}`,text:`${decision.reason}\n${saved.alerts?'New alert saved in Radar Alerts.':'No new alert.'}`,sourceIds:[sources.find(source=>source.url===decision.url)!.id]});}
   result.blocks.unshift({title:'Coverage Check',text:`${pool!.total} matching collected articles; ${pool!.known} already judged; ${sources.length} checked; ${recorded} new decisions; ${alerts} new alerts. Only source-supported real features alert. Other decisions remain saved to suppress repeats.`,sourceIds:[]});
  }
  result.warnings.push('Evidence and model judgements remain drafts for a person. Failed or unused reserved calls do not refund daily capacity.');
  const incomplete=sources.some(source=>!source.read)||(mode!=='calendar'&&items.length!==sources.length)||result.claims.some(claim=>claim.status==='missing-source'||claim.status==='stated');
  if(incomplete)result.warnings.push('Incomplete: one or more sources, model judgements or stance checks are unavailable or need context review. No unsupported first pick, calendar date or coverage alert is approved.');
  publicBrandGuard(project.name,JSON.stringify(result));
  await db.update(newsjackPlanningRuns).set({result,status:incomplete?'incomplete':'complete'}).where(and(eq(newsjackPlanningRuns.id,runId),eq(newsjackPlanningRuns.projectId,project.id)));
  return Response.json({run:planningRunForViewer(await savedPlanningRun(project.id,runId,db),isAdmin(user))});
 }catch{
  console.warn('[newsjack-planning]',{reason:'planning_failed'});
  if(runId!==null&&projectId!==null)try{await (await getDb()).update(newsjackPlanningRuns).set({status:'failed',error:'Planning could not complete; no unchecked draft was published.'}).where(and(eq(newsjackPlanningRuns.id,runId),eq(newsjackPlanningRuns.projectId,projectId)))}catch{/* Reservation remains durable. */}
  return Response.json({error:'Planning could not complete. Check source readability, current dates and public-only inputs; no unchecked draft was published.'},{status:503});
 }
}
