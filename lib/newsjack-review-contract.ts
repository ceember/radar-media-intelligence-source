import {z} from 'zod';
import {reporterBodySentences,reporterSentenceQuote} from './newsjack-reporter-sentences';
import type {NewsjackSource} from './newsjack-types';

export type ReviewEditorStatus='unavailable'|'no-response'|'response-size'|'fenced-json'|'invalid-json'|'invalid-schema'|'invalid-span'|'parsed';
export type ReviewEditorDiagnostic={status:ReviewEditorStatus;claimCount:number|null};

export function reviewEligibleSourceIds(sources:NewsjackSource[]){
 return sources.filter(source=>source.read&&source.url&&reporterBodySentences(source).length).map(source=>source.id);
}
function reviewSchema(sources:NewsjackSource[]){
 const ids=reviewEligibleSourceIds(sources);
 return z.strictObject({
  stories:z.array(z.strictObject({id:z.number().int().positive()})).max(0),
  blocks:z.array(z.strictObject({title:z.string().min(1).max(200),text:z.string().min(1).max(3000),sourceIds:z.array(z.number().int().positive()).min(1).max(6)})).max(20),
  claims:z.array(z.strictObject({claim:z.string().min(1).max(600),sourceId:z.literal([...ids,null]),sentenceIds:z.array(z.number().int().min(1).max(200)).max(3)})).max(30),
  warnings:z.array(z.string().trim().min(1).max(2000)).max(10),
 });
}
export function reviewJsonSchema(sources:NewsjackSource[]){
 const schema=z.toJSONSchema(reviewSchema(sources));delete schema.$schema;return schema;
}
export function reviewSourcesForPrompt(sources:NewsjackSource[]){
 return sources.filter(source=>source.text.trim()).map(source=>{
  const {text,...metadata}=source;void text;
  return {...metadata,bodySentences:reporterBodySentences(source).map(({id,text})=>({id,text}))};
 });
}
export function parseReviewSelection(raw:string|null,sources:NewsjackSource[]){
 const rejected=(status:Exclude<ReviewEditorStatus,'parsed'>,claimCount:number|null=null)=>({value:null,diagnostic:{status,claimCount} as ReviewEditorDiagnostic});
 if(!raw?.trim())return rejected('no-response');
 if(raw.length>100000)return rejected('response-size');
 if(/^\s*```/.test(raw))return rejected('fenced-json');
 let decoded:unknown;try{decoded=JSON.parse(raw)}catch{return rejected('invalid-json')}
 const parsed=reviewSchema(sources).safeParse(decoded);
 if(!parsed.success)return rejected('invalid-schema');
 const claims=[];
 for(const claim of parsed.data.claims){
  if(claim.sourceId===null){
   if(claim.sentenceIds.length)return rejected('invalid-span',parsed.data.claims.length);
   claims.push({claim:claim.claim,sourceId:null,evidenceQuote:''});continue;
  }
  const source=sources.find(source=>source.id===claim.sourceId&&source.read&&source.url);
  const quote=source?reporterSentenceQuote(source,claim.sentenceIds):null;
  if(quote===null||(quote.length>0&&(quote.length<12||quote.length>600)))return rejected('invalid-span',parsed.data.claims.length);
  claims.push({claim:claim.claim,sourceId:quote?claim.sourceId:null,evidenceQuote:quote});
 }
 return {value:{...parsed.data,claims},diagnostic:{status:'parsed',claimCount:claims.length} as ReviewEditorDiagnostic};
}
