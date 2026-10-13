import {and,eq} from 'drizzle-orm';
import {getCurrentUser,userAiEnabled,isAdmin} from '@/lib/auth';
import {getCurrentProject} from '@/lib/data';
import {isDemoMode} from '@/lib/session';
import {researchCanWrite,researchSameOrigin} from '@/lib/web-research';
import {getDb} from '@/lib/db';
import {newsjackVisibilityRuns} from '@/lib/db/schema';
import {aiStatus,callClaudeDetailed,MODELS} from '@/lib/claude';
import {publicBrandGuard} from '@/lib/newsjack';
import {visibilityInputSchema,visibilityPrompt,guardVisibility} from '@/lib/newsjack-visibility';
import {reserveVisibility,savedVisibility} from '@/lib/newsjack-visibility-store';
import {VisibilityAuditFailure,visibilityFailureForError,visibilityProviderFailure,visibilityRunForViewer} from '@/lib/newsjack-visibility-diagnostics';
import type {VisibilityFailureClass} from '@/lib/newsjack-visibility-types';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(req:Request){
 let runId:number|null=null,projectId:number|null=null;
 let administrator=false,phase:VisibilityFailureClass='guard';
 const reject=(error:string,status:number,failureClass:VisibilityFailureClass)=>Response.json({error,...(administrator?{failureClass}:{})},{status});
 try{
  if(!researchSameOrigin(req.headers.get('origin'),req.url,req.headers.get('host')))return Response.json({error:'Cross-site requests are not allowed.'},{status:403});
  if(!req.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Send JSON.'},{status:415});
  const user=await getCurrentUser();if(!user)return Response.json({error:'Sign in.'},{status:401});
  administrator=isAdmin(user);
  const project=await getCurrentProject();if(!project)return Response.json({error:'No accessible project.'},{status:404});
  if(isDemoMode()||!researchCanWrite(user,project))return Response.json({error:'Only the project owner or an admin can run audits. Readers see saved results.'},{status:403});
  if(Number(req.headers.get('content-length'))>24000)return reject('Request too large.',400,'input_too_long');
  const raw=await req.text();if(raw.length>24000)return reject('Request too large.',400,'input_too_long');
  let body;try{body=JSON.parse(raw);}catch{return reject('Invalid JSON.',400,'schema');}
  if(body?.projectId!==project.id)return Response.json({error:'Reload the current project.'},{status:409});
  if(body.publicOnly!==true)return Response.json({error:'Confirm that all supplied material is public and approved.'},{status:400});
  if(body.action!=='audit')return Response.json({error:'Only supplied-copy audits are supported; no rewrite or panel run.'},{status:400});
  const parsed=visibilityInputSchema.safeParse(body.input);
  if(!parsed.success)return reject('Supply bounded copy, document context, up to four reader queries and public evidence URLs tied to exact copy passages.',400,parsed.error.issues.some(issue=>issue.code==='too_big')?'input_too_long':'schema');
  publicBrandGuard(project.name,JSON.stringify(parsed.data));
  if(!userAiEnabled(user))return Response.json({error:'AI is not enabled for this account.'},{status:403});
  const ai=await aiStatus();if(!ai.ready)return reject(ai.capReached?'AI spend cap reached.':'AI is not configured or enabled.',ai.capReached?429:503,ai.capReached?'quota':'guard');
  projectId=project.id;const db=await getDb();runId=await reserveVisibility(project.id,user.id,JSON.stringify(parsed.data),db);
  if(runId===null)return reject('Newsjack daily limit reached (30 AI calls across its pages). Resets at midnight UTC.',429,'quota');
  phase='provider_error';
  const prompt=visibilityPrompt(parsed.data),response=await callClaudeDetailed(MODELS.haiku,'newsjack_visibility_audit',prompt.system,prompt.user,2000,false,30000);
  if(!response.text)throw new VisibilityAuditFailure(visibilityProviderFailure(response.failure));
  phase='schema';
  const result=guardVisibility(response.text,parsed.data,new Date().toISOString());
  phase='guard';
  publicBrandGuard(project.name,JSON.stringify({...parsed.data,changes:result.changes.map(({passage,lever})=>({passage,lever})),claimsToCheck:result.claimsToCheck}));
  await db.update(newsjackVisibilityRuns).set({status:'complete',result}).where(and(eq(newsjackVisibilityRuns.id,runId),eq(newsjackVisibilityRuns.projectId,project.id)));
  const run=await savedVisibility(project.id,runId,db);
  return Response.json({run:run?visibilityRunForViewer(run,administrator):null});
 }catch(cause){
  const failureClass=visibilityFailureForError(cause,phase);
  console.warn('[newsjack-visibility]',{reason:'audit_failed',failureClass});
  if(runId!==null&&projectId!==null)try{await (await getDb()).update(newsjackVisibilityRuns).set({status:'failed',result:null,failureClass,error:'Audit could not complete. No unchecked suggestions were published.'}).where(and(eq(newsjackVisibilityRuns.id,runId),eq(newsjackVisibilityRuns.projectId,projectId)));}catch{}
  return reject('Audit could not complete. No unchecked suggestions were published.',503,failureClass);
 }
}
