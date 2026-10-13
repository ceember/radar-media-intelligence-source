import {z} from 'zod';
import type {NewsjackSavedRun} from './newsjack-types';

const count=z.number().int().min(0).max(30);
const diagnostics=z.object({
 editor:z.object({status:z.enum(['unavailable','no-response','response-size','fenced-json','invalid-json','invalid-schema','invalid-span','parsed']),claimCount:count.nullable()}),
 stance:z.object({
  status:z.enum(['not-called','no-response','unavailable','response-size','invalid-json','invalid-schema','cardinality','parsed']),
  expectedCount:count,contextCount:count,eligibleCount:count,parsedCount:z.number().int().min(0).max(8000).nullable(),
  verdictCounts:z.object({supports:count,contradicts:count,hypothetical_or_negated:count,unrelated:count}).nullable(),
 }),
});

export function projectReviewRun(run:NewsjackSavedRun,canInspect=false):NewsjackSavedRun{
 if(!run.result)return {...run};
 const {reviewDiagnostics,...result}=run.result;
 const parsed=canInspect===true&&run.mode==='review'?diagnostics.safeParse(reviewDiagnostics):null;
 return {...run,result:parsed?.success?{...result,reviewDiagnostics:parsed.data}:result};
}
