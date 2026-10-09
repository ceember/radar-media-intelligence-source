import type {NewsjackSavedRun} from './newsjack-types';
export type PlanningMode='crisis'|'calendar'|'coverage'|'journalists';
export type PlanningRun=Omit<NewsjackSavedRun,'mode'>&{mode:PlanningMode};
export const PLANNING_TITLES:Record<PlanningMode,string>={crisis:'Crisis Holding',calendar:'PR Calendar',coverage:'Coverage Tracker',journalists:'Journalist Fit'};
export type CoverageConfig={keyword:string;meaning:string;exclusions:string[]};
export type CoverageVerdict='real_feature'|'substantive_mention'|'passing_mention'|'wrong_entity'|'junk'|'uncertain';
export type CoverageDecision={url:string;title:string;verdict:CoverageVerdict;quote:string;reason:string;alert:boolean};
