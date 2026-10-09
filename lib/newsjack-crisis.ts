import {z} from 'zod';
import {cleanStoredText} from './text-clean';
import type {NewsjackResult} from './newsjack-types';
const text=(max:number)=>z.string().trim().min(1).max(max).transform(value=>cleanStoredText(value));
export const crisisSchema=z.object({
  summary:text(600),type:z.enum(['product safety','data security','personnel misconduct','financial irregularity','regulatory','product outage','viral social event','executive statement backlash','third-party action','landmine newsjack','other']),
  firstKnownAt:z.iso.datetime({offset:true}),org:text(100),role:text(100),audience:text(150),facts:z.array(text(500)).min(1).max(8),unknowns:text(1000),actions:z.array(text(500)).min(1).max(6),commitments:z.array(text(500)).max(3).default([]),
  people:text(300),namesConsented:z.boolean(),legalStatus:z.enum(['no counsel yet','counsel engaged and reviewing','counsel approved the draft path']),regulatoryExposure:text(600),inquiry:z.enum(['none yet','within 24h','within 4h','within 1h','already published']),postStillLive:z.boolean(),legalGateAcknowledged:z.literal(true),
});
export type CrisisIntake=z.infer<typeof crisisSchema>;
const legalMarkers=/\b(?:death|dead|fatal\w*|injur\w*|hospital\w*|harass\w*|assault|discriminat\w*|fraud|theft|PII|personal data|ransomware|breach|minor\w*|child\w*|public safety|recall|lawsuit|class action|subpoena|criminal|broken the law|illegal|SEC|FDA|OSHA|FTC|CPSC|GDPR|DPA|HIPAA|CCPA|CSAM|indict\w*|immigration|ICE|weapons?|defen[cs]e|export.control|antitrust|DOJ|EU Commission|regulator\w*)\b/i;
const words=(value:string)=>value.trim().split(/\s+/).filter(Boolean).length;
const questions=[['Facts','What has happened?'],['Scope','Who is affected?'],['Scope','How many people are affected?'],['Responsibility','Who is responsible?'],['Remediation','What have you done?'],['People','Who can speak about this?'],['Timeline','When did you know?'],['Timeline','When will you update us?'],['Legal','Have authorities been notified?'],['Business','What is the financial impact?']];
/** Statements copy only confirmed intake. Unknowns never become incident assertions. */
export function crisisHolding(intake:CrisisIntake,now:string):NewsjackResult {
 const result:NewsjackResult={opportunities:[],blocks:[],claims:[],sources:[],warnings:['A person must confirm before sending']};
 if(Date.parse(intake.firstKnownAt)>Date.parse(now))throw Error('Use a first-known time that is not in the future.');
 const evidence=[intake.summary,...intake.facts,intake.unknowns,...intake.actions,...intake.commitments,intake.regulatoryExposure].join('\n'),triggers:string[]=[];
 if(intake.postStillLive)triggers.push('The offending post is still live. Remove it before drafting.');
 if(intake.people.toLowerCase()!=='none'&&!intake.namesConsented)triggers.push('Named people have not consented.');
 const risk=['product safety','data security','personnel misconduct','financial irregularity','regulatory'].includes(intake.type)||legalMarkers.test(evidence)||intake.regulatoryExposure.toLowerCase()!=='none';
 if(risk&&intake.legalStatus==='no counsel yet')triggers.push('Incident or exposure requires engaged legal counsel.');
 if(triggers.length){result.blocks=[{title:'STOP — Legal Counsel Required Before Any External Statement',text:triggers.join('\n')+'\nPage counsel, resolve the gate, then rerun. No statement or Q And A was drafted.',sourceIds:[]}];return result;}
 const banner='DRAFT — NOT FOR PUBLICATION — FOR COUNSEL REVIEW ONLY';
 const short=[intake.facts[0],intake.actions[0]].join(' '),medium=[...intake.facts,...intake.actions,...intake.commitments].join('\n'),cautious='Based on the confirmed facts supplied for counsel review:\n'+[...intake.facts,...intake.actions].join('\n');
 for(const [title,body,limit] of [['Short Statement',short,50],['Medium Statement',medium,140],['Cautious Legal Pass',cautious,150]] as const)result.blocks.push({title,text:words(body)<=limit?`${banner}\n${words(body)} words\n${body}`:`Variant withheld: supplied facts and actions exceed ${limit} words. Supply concise complete sentences; no fact was cut mid-sentence.`,sourceIds:[]});
 result.blocks.push({title:'Deltas For Counsel',text:'Cautious legal pass adds an intake-source qualification and omits future commitments. It does not change an action’s completion status or grant legal clearance.',sourceIds:[]});
 const qa=questions.filter(([category])=>intake.type!=='landmine newsjack'||!['Business','Remediation'].includes(category));
 if(intake.type==='landmine newsjack')qa.push(['Facts','What was posted?'],['Timeline','When was the post removed?']);
 result.blocks.push({title:'Journalist Q And A Posture',text:qa.map(([category,question])=>`${category}: ${question}\n${category==='Legal'?'Refer To Counsel':'Block And Bridge'} — Avoid assumptions beyond the intake.\nDraft response: ${category==='Facts'?intake.facts[0]:category==='Remediation'?intake.actions[0]:'I cannot add a confirmed answer beyond the holding statement. Refer to the confirmed facts; do not speculate.'}`).join('\n\n'),sourceIds:[]});
 result.blocks.push({title:'What Not To Say',text:'Do not claim an isolated incident, no harm, no data loss, fault, a refund, an apology or a deadline unless defensible from the intake. Do not name unconsented people. Do not turn unknowns into reassuring assertions. Do not add marketing, values, campaign or product language to a landmine response.',sourceIds:[]});
 const hours=intake.type==='landmine newsjack'?0.5:['within 1h','already published'].includes(intake.inquiry)?1:intake.type==='data security'&&/GDPR|CCPA|HIPAA/i.test(intake.regulatoryExposure)?2:4;
 result.crisis={issuedAt:now,validUntil:new Date(Date.parse(now)+hours*3_600_000).toISOString()};
 result.blocks.push({title:'Decay And Refresh',text:`Issued ${now}. Valid until ${result.crisis.validUntil}. Rerun the intake and legal gate after any new public fact, regulator contact, second incident, new named person or this expiry. Counsel must review before external use. No AI call was used.`,sourceIds:[]});
 result.warnings.push('Confirmed-intake templates, not legal clearance. Unknown facts are omitted from statements.');
 return result;
}
