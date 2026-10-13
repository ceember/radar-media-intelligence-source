import {z} from 'zod';
import {claimSourceContext} from './newsjack-facts';
import type {NewsjackClaim,NewsjackSource} from './newsjack-types';
import type {ReviewEditorDiagnostic} from './newsjack-review-contract';

const verdicts=['supports','contradicts','hypothetical_or_negated','unrelated'] as const;
const stance=z.array(z.enum(verdicts)).max(30);
export type ReviewStanceStatus='not-called'|'no-response'|'unavailable'|'response-size'|'invalid-json'|'invalid-schema'|'cardinality'|'parsed';
export type ReviewStanceDiagnostic={status:ReviewStanceStatus;expectedCount:number;contextCount:number;eligibleCount:number;parsedCount:number|null;verdictCounts:Record<typeof verdicts[number],number>|null};
export type ReviewDiagnostics={editor:ReviewEditorDiagnostic;stance:ReviewStanceDiagnostic};

export function reviewStanceDiagnostic(claims:NewsjackClaim[],sources:NewsjackSource[],raw:string|null,attempted:boolean,unavailable=false):ReviewStanceDiagnostic{
 const contexts=claims.map(claim=>claimSourceContext(claim,sources));
 const diagnostic:ReviewStanceDiagnostic={status:'not-called',expectedCount:Math.min(8000,claims.length),contextCount:contexts.filter(Boolean).length,eligibleCount:contexts.filter(context=>context&&!context.needsContextReview).length,parsedCount:null,verdictCounts:null};
 if(!attempted)return diagnostic;
 if(unavailable)return {...diagnostic,status:'unavailable'};
 if(!raw?.trim())return {...diagnostic,status:'no-response'};
 if(raw.length>24000)return {...diagnostic,status:'response-size'};
 let decoded:unknown;try{decoded=JSON.parse(raw)}catch{return {...diagnostic,status:'invalid-json'}}
 if(Array.isArray(decoded))diagnostic.parsedCount=Math.min(8000,decoded.length);
 const parsed=stance.safeParse(decoded);
 if(!parsed.success)return {...diagnostic,status:'invalid-schema'};
 if(parsed.data.length!==claims.length)return {...diagnostic,status:'cardinality'};
 const verdictCounts={supports:0,contradicts:0,hypothetical_or_negated:0,unrelated:0};
 for(const verdict of parsed.data)verdictCounts[verdict]++;
 return {...diagnostic,status:'parsed',verdictCounts};
}
