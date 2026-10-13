import { and, eq } from 'drizzle-orm';
import { getCurrentUser, isAdmin, userAiEnabled } from '@/lib/auth';
import { getCurrentProject } from '@/lib/data';
import { getDb } from '@/lib/db';
import { newsjackRuns } from '@/lib/db/schema';
import { isDemoMode } from '@/lib/session';
import { researchCanWrite, researchSameOrigin } from '@/lib/web-research';
import { aiStatus, callClaude, MODELS } from '@/lib/claude';
import { cleanStoredText } from '@/lib/text-clean';
import { coarseNewsjack, guardNewsjackResult, NEWSJACK_SAFETY, newsjackPrompt, profileSchema, publicBrandGuard } from '@/lib/newsjack';
import { newsjackProfile, newsjackStories, reserveNewsjack, savedNewsjackRun, saveNewsjackProfile } from '@/lib/newsjack-store';
import { newsjackOriginSources, readNewsjackSource } from '@/lib/newsjack-sources';
import { researchPublicUrl } from '@/lib/tavily-research';
import type { NewsjackMode, NewsjackResult, NewsjackSource } from '@/lib/newsjack-types';
import {claimSourceContext,factStancePrompt} from '@/lib/newsjack-facts';
import {parseReviewSelection,reviewJsonSchema} from '@/lib/newsjack-review-contract';
import {reviewStanceDiagnostic,type ReviewDiagnostics} from '@/lib/newsjack-review-diagnostics';
import {projectReviewRun} from '@/lib/newsjack-review-projection';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;

export async function POST(req:Request) {
  let runId:number|null=null, projectId:number|null=null;
  let canInspect=false, reviewDiagnostics:ReviewDiagnostics|undefined;
  try {
    if(!researchSameOrigin(req.headers.get('origin'),req.url,req.headers.get('host'))) return Response.json({error:'Cross-site requests are not allowed.'},{status:403});
    if(!req.headers.get('content-type')?.startsWith('application/json')) return Response.json({error:'Send JSON.'},{status:415});
    const user=await getCurrentUser(); if(!user) return Response.json({error:'Sign in.'},{status:401});
    canInspect=isAdmin(user);
    const project=await getCurrentProject(); if(!project) return Response.json({error:'No accessible project.'},{status:404});
    if(isDemoMode()||!researchCanWrite(user,project)) return Response.json({error:'Only the project owner or an admin can write or run Newsjack. Readers see saved results.'},{status:403});
    if(Number(req.headers.get('content-length'))>24_000) return Response.json({error:'Request too large.'},{status:400});
    const raw=await req.text(); if(raw.length>24_000) return Response.json({error:'Request too large.'},{status:400});
    let body;try{body=JSON.parse(raw)}catch{return Response.json({error:'Invalid JSON.'},{status:400})}
    if(body?.projectId!==project.id) return Response.json({error:'Reload the current project.'},{status:409});
    if(body.publicOnly!==true) return Response.json({error:'Confirm that all supplied information and assets are public.'},{status:400});
    projectId=project.id;
    if(body.action==='profile') {
      const parsed=profileSchema.safeParse(body.profile);
      if(!parsed.success) return Response.json({error:'Use bounded profile fields and public proof-source URLs.'},{status:400});
      publicBrandGuard(project.name,JSON.stringify(parsed.data));
      await saveNewsjackProfile(project.id,parsed.data);
      return Response.json({profile:parsed.data});
    }
    if(!['opportunities','angles','review'].includes(body.mode)) return Response.json({error:'Choose a Newsjack page.'},{status:400});
    const mode=body.mode as NewsjackMode;
    let input=typeof body.input==='string'?cleanStoredText(body.input,8000).trim():'';
    if(mode!=='opportunities' && (typeof body.input!=='string'||!input||Array.from(body.input).length>8000) && !body.opportunityRunId) return Response.json({error:'Supply 1–8000 characters of public facts or pitch text.'},{status:400});
    const sourceUrls=Array.isArray(body.sourceUrls)?body.sourceUrls:[];
    if(sourceUrls.length>4||sourceUrls.some((url:unknown)=>!researchPublicUrl(url))) return Response.json({error:'Use up to four public source URLs.'},{status:400});
    if(mode==='angles'&&body.opportunityRunId) {
      if(!Number.isSafeInteger(body.opportunityRunId)||!Number.isSafeInteger(body.opportunityId)) return Response.json({error:'Invalid saved opportunity.'},{status:400});
      const saved=await savedNewsjackRun(project.id,body.opportunityRunId);
      const opportunity=saved?.mode==='opportunities'&&saved.result?.opportunities.find(o=>o.id===body.opportunityId);
      if(!opportunity) return Response.json({error:'Opportunity not found in this project.'},{status:404});
      input=cleanStoredText(`${opportunity.title}\n${opportunity.text}\nPublisher Date: ${opportunity.publishedAt}\nSource: ${opportunity.url}\nOrigin: ${opportunity.freshness}`,8000);
    }
    publicBrandGuard(project.name,input);
    if(mode==='angles'&&NEWSJACK_SAFETY.test(input)) return Response.json({error:'Tragedy is not a promotional hook. No angles were generated.'},{status:422});
    if(!userAiEnabled(user)) return Response.json({error:'AI is not enabled for this account.'},{status:403});
    const profile=await newsjackProfile(project.id);
    publicBrandGuard(project.name,JSON.stringify(profile));
    const pool=mode==='opportunities'?coarseNewsjack((await newsjackStories(project.id)).filter(s=>{
      try{publicBrandGuard(project.name,`${s.title} ${s.text}`);return true}catch{return false}
    }),profile):null;
    const stories=pool?.stories??[];
    if(mode==='opportunities'&&!stories.length) {
      const result:NewsjackResult={opportunities:[],blocks:[],claims:[],sources:[],warnings:['A person must confirm before sending',`No eligible recent news. Filtered: ${JSON.stringify(pool?.counts)}. No AI call or daily AI slot used.`]};
      const [row]=await (await getDb()).insert(newsjackRuns).values({projectId:project.id,userId:user.id,mode,input:'Recent Project News',status:'complete',result}).returning();
      return Response.json({run:{...row,createdAt:row.createdAt.toISOString()}});
    }
    const ai=await aiStatus(); if(!ai.ready) return Response.json({error:ai.capReached?'AI spend cap reached.':'AI is not configured or enabled.'},{status:ai.capReached?429:503});
    const db=await getDb();
    runId=await reserveNewsjack(project.id,user.id,mode,input||'Recent Project News',db);
    if(runId===null) return Response.json({error:'Newsjack daily limit reached (30 AI calls; Pitch Review needs two slots). Resets at midnight UTC.'},{status:429});
    let sources:NewsjackSource[]=[], searched=false;
    if(mode==='opportunities') {
      const origin=await newsjackOriginSources(stories);sources=origin.sources;searched=origin.searchedIds.length===stories.length;
    } else {
      sources=[{id:1,title:mode==='angles'?'Supplied Update':'Pitch Under Review',url:null,text:input,publishedAt:null,checkedAt:new Date().toISOString(),read:false}];
      for(const url of [...new Set(sourceUrls)] as string[]) sources.push(await readNewsjackSource(url,sources.length+1));
    }
    // Public-only policy applies to read evidence too, before sending it to AI or saving it.
    for(const source of sources) publicBrandGuard(project.name,source.text);
    const now=new Date().toISOString(), prompt=newsjackPrompt(mode,project.name,profile,input,stories,sources,now,searched);
    if(mode==='review')reviewDiagnostics={editor:{status:'unavailable',claimCount:null},stance:reviewStanceDiagnostic([],sources,null,false)};
    const response=await callClaude(MODELS.haiku,`newsjack_${mode}`,prompt.system,prompt.user,5000,false,35_000,mode==='review'?{name:'pitch_review_selection',schema:reviewJsonSchema(sources)}:undefined);
    let guardedResponse=response;
    if(mode==='review'){
      const selection=parseReviewSelection(response,sources);
      reviewDiagnostics!.editor=selection.diagnostic;
      if(!selection.value)throw new Error('AI returned an incomplete draft. No result was published.');
      guardedResponse=JSON.stringify(selection.value);
    }
    if(!response) throw new Error('AI returned no usable text. Check the configured engine and spend cap.');
    let result=guardNewsjackResult(guardedResponse!,mode,input,profile,stories,sources,now,searched);
    if(mode==='review')reviewDiagnostics!.stance=reviewStanceDiagnostic(result.claims,sources,null,false);
    if(mode==='review'&&result.claims.some(claim=>claimSourceContext(claim,sources))) {
      const stancePrompt=factStancePrompt(result.claims,sources);
      // Review reserved two daily slots up front. Failed/omitted second calls never refund capacity.
      let stance:string|null=null, unavailable=false;
      try {stance=await callClaude(MODELS.haiku,'newsjack_source_stance',stancePrompt.system,stancePrompt.user,500,false,20_000);}
      catch {unavailable=true;console.warn('[newsjack] source stance unavailable');}
      reviewDiagnostics!.stance=reviewStanceDiagnostic(result.claims,sources,stance,true,unavailable);
      result=guardNewsjackResult(guardedResponse!,mode,input,profile,stories,sources,now,searched,stance);
    }
    if(reviewDiagnostics)result.reviewDiagnostics=reviewDiagnostics;
    publicBrandGuard(project.name,JSON.stringify(result));
    if(pool) result.warnings.push(`Checked ${pool.total} eligible stories; this bounded run assessed ${stories.length}. Filter counts: ${JSON.stringify(pool.counts)}.`);
    await db.update(newsjackRuns).set({result,status:result.outcome??(result.factCheck==='incomplete'?'incomplete':'complete')}).where(and(eq(newsjackRuns.id,runId),eq(newsjackRuns.projectId,project.id)));
    const saved=await savedNewsjackRun(project.id,runId,db);
    return Response.json({run:saved?projectReviewRun(saved,canInspect):null});
  } catch(error) {
    const message=error instanceof Error&&/^(AI |Use |Promotional |Primary|Tragedy|Incomplete:)/.test(error.message)?cleanStoredText(error.message,300):'Newsjack could not complete. No unchecked result was published.';
    let failedRun=null;
    if(runId!==null&&projectId!==null) {
      try{
        const db=await getDb();
        const result:NewsjackResult|undefined=reviewDiagnostics?{opportunities:[],blocks:[],claims:[],sources:[],warnings:[],reviewDiagnostics}:undefined;
        await db.update(newsjackRuns).set({status:'failed',error:message,...(result?{result}:{})}).where(and(eq(newsjackRuns.id,runId),eq(newsjackRuns.projectId,projectId)));
        failedRun=await savedNewsjackRun(projectId,runId,db);
        if(failedRun)failedRun=projectReviewRun(failedRun,canInspect);
      }catch{/* Reserved run and cap remain durable. */}
    }
    return Response.json({error:message,run:failedRun},{status:503});
  }
}
