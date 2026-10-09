import type {PlanningRun} from './newsjack-planning-types';

export function planningRunForViewer(run:PlanningRun|null,admin:boolean):PlanningRun|null{
 if(!run?.result||admin)return run;
 const result={...run.result};delete result.reporterDiagnostics;delete result.reporterParse;
 return {...run,result};
}
