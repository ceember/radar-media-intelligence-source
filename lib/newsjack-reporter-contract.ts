import {z} from 'zod';
import type {PlanningJudgement} from './newsjack-planning';
import type {NewsjackSource,ReporterParseDiagnostic,ReporterParseStatus,ReporterSchemaError,ReporterSchemaErrorRule} from './newsjack-types';
import {reporterSentenceQuote} from './newsjack-reporter-sentences';

const sourceIds=(sources:NewsjackSource[])=>sources.filter(source=>source.read).map(source=>source.id);
function responseSchema(sources:NewsjackSource[]){
 const ids=sourceIds(sources);
 if(!ids.length||ids.length>4||new Set(ids).size!==ids.length)throw Error('Reporter source contract unavailable');
 return z.strictObject({results:z.array(z.strictObject({sourceId:z.literal(ids),sentenceIds:z.array(z.number().int().min(1).max(200)).max(3)})).length(ids.length)});
}
export function reporterJsonSchema(sources:NewsjackSource[]){
 const schema=z.toJSONSchema(responseSchema(sources));
 delete schema.$schema;
 return schema;
}
function valueAtPath(decoded:unknown,path:PropertyKey[]){
 let value=decoded;
 for(const segment of path)value=value!==null&&typeof value==='object'?Reflect.get(value,segment):undefined;
 return value;
}
function safeSchemaErrors(issues:readonly z.core.$ZodIssue[],decoded:unknown):ReporterSchemaError[]{
 return issues.slice(0,3).map(issue=>{
  const path=issue.path;
  let field='$';
  if(path[0]==='results'){
   field+='.'+path[0];
   if(typeof path[1]==='number'&&Number.isInteger(path[1])&&path[1]>=0&&path[1]<4){
    field+=`[${path[1]}]`;
    if(['sourceId','sentenceIds'].includes(String(path[2])))field+='.'+String(path[2]);
    if(path[2]==='sentenceIds'&&typeof path[3]==='number'&&Number.isInteger(path[3])&&path[3]>=0&&path[3]<3)field+=`[${path[3]}]`;
   }
  }
  let rule:ReporterSchemaErrorRule='type';
  if(issue.code==='invalid_type')rule=valueAtPath(decoded,path)===undefined?'required':'type';
  else if(issue.code==='invalid_value')rule=path[2]==='sourceId'&&typeof valueAtPath(decoded,path)!=='number'?'type':'enum';
  else if(issue.code==='too_big')rule=issue.origin==='string'?'max-length':'max-items';
  else if(issue.code==='too_small')rule='required';
  else if(issue.code==='unrecognized_keys')rule='additional-properties';
  return {field,rule};
 });
}
export function parseReporterJudgement(raw:string|null,sources:NewsjackSource[]):{items:PlanningJudgement[];diagnostic:ReporterParseDiagnostic}{
 const expectedSourceIds=sourceIds(sources);
 const rejected=(status:ReporterParseStatus,errors?:ReporterSchemaError[])=>({items:[],diagnostic:{status,expectedSourceIds,...(errors?.length?{errors}:{})}});
 if(raw===null||!raw.trim())return rejected('no-response');
 if(raw.length>24000)return rejected('invalid-schema',[{field:'$',rule:'response-size'}]);
 if(/^\s*```/.test(raw))return rejected('fenced-json');
 if(!expectedSourceIds.length||expectedSourceIds.length>4||new Set(expectedSourceIds).size!==expectedSourceIds.length)return rejected('invalid-schema');
 let decoded:unknown;try{decoded=JSON.parse(raw)}catch{return rejected('invalid-json')}
 const results=valueAtPath(decoded,['results']);
 if(Array.isArray(results)&&results.length===0)return rejected('empty-selection');
 const parsed=responseSchema(sources).safeParse(decoded);
 if(!parsed.success){
  const errors=safeSchemaErrors(parsed.error.issues,decoded);
  if(parsed.error.issues.some(issue=>issue.path[2]==='sourceId'&&issue.code==='invalid_value'&&typeof valueAtPath(decoded,issue.path)==='number'))return rejected('unknown-id',errors);
  if(Array.isArray(results)&&results.length<=4&&parsed.error.issues.every(issue=>issue.path.length===1&&issue.path[0]==='results')){
   const ids=results.map(item=>valueAtPath(item,['sourceId']));
   if(new Set(ids).size!==ids.length)return rejected('duplicate-id',errors);
   if(results.length<expectedSourceIds.length)return rejected('missing-source',errors);
  }
  return rejected('invalid-schema',errors);
 }
 if(new Set(parsed.data.results.map(item=>item.sourceId)).size!==parsed.data.results.length)return rejected('duplicate-id');
 if(expectedSourceIds.some(id=>!parsed.data.results.some(item=>item.sourceId===id)))return rejected('missing-source');
 const items:PlanningJudgement[]=[];
 for(const [index,item] of parsed.data.results.entries()){
  const source=sources.find(source=>source.read&&source.id===item.sourceId)!;
  const quote=reporterSentenceQuote(source,item.sentenceIds);
  if(quote===null)return rejected('invalid-schema',[{field:`$.results[${index}].sentenceIds`,rule:'enum'}]);
  items.push({sourceId:item.sourceId,quote,verdict:quote?'soft-fit':'unknown',reason:quote?'Exact BODY sentences selected; separate stance and human review required.':'No supporting BODY sentences selected.',edits:[]});
 }
 return {items,diagnostic:{status:'parsed',expectedSourceIds}};
}
