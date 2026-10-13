import type {AiFailure} from './claude';
import type {VisibilityFailureClass,VisibilityRun} from './newsjack-visibility-types';

const failureClasses:readonly VisibilityFailureClass[]=['input_too_long','guard','quota','provider_error','schema','timeout'];
export function normalizeVisibilityFailureClass(value:unknown):VisibilityFailureClass|null{
 return typeof value==='string'&&failureClasses.includes(value as VisibilityFailureClass)?value as VisibilityFailureClass:null;
}
export class VisibilityAuditFailure extends Error{
 constructor(readonly failureClass:VisibilityFailureClass){super('Writing audit failed');}
}
export function visibilityFailureForError(error:unknown,phase:VisibilityFailureClass):VisibilityFailureClass{
 if(error instanceof VisibilityAuditFailure)return normalizeVisibilityFailureClass(error.failureClass)??phase;
 if(phase==='provider_error'&&error instanceof Error&&/\b(?:too many tokens|context length|request too large)\b/i.test(error.message))return 'input_too_long';
 if(error instanceof Error&&(['TimeoutError','AbortError'].includes(error.name)||(phase==='provider_error'&&/\b(?:timeout|timed out|time limit|request budget)\b/i.test(error.message))))return 'timeout';
 return phase;
}
export function visibilityProviderFailure(failure:AiFailure|undefined):VisibilityFailureClass{
 if(failure?.why==='budget')return 'quota';
 if(failure&&['disabled','demo','no-key'].includes(failure.why))return 'guard';
 if(failure?.why==='call-failed'&&/\b(?:timeout|timed out|time limit)\b/i.test(failure.message))return 'timeout';
 return 'provider_error';
}
export function visibilityRunForViewer(run:VisibilityRun,administrator:boolean):VisibilityRun{
 const {failureClass,...visible}=run;
 return administrator?{...visible,failureClass:normalizeVisibilityFailureClass(failureClass)}:visible;
}
