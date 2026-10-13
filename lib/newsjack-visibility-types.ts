export type VisibilityLever='unique-evidence'|'scoped-answer'|'attribution'|'entities'|'headings'|'format'|'freshness'|'promotion'|'precision'|'padding';
export type VisibilityQuestion='evidence'|'scope'|'query';
export type VisibilityFailureClass='input_too_long'|'guard'|'quota'|'provider_error'|'schema'|'timeout';
export type VisibilityInput={
 copy:string;documentType:'press-release'|'blog'|'contributed-article'|'expert-explainer';
 publisher:string;audience:string;purpose:string;queries:string[];
 evidence:{url:string;passage:string}[];
};
export type VisibilityChange={passage:string;lever:VisibilityLever;title:string;action:string;why:string;confidence:'supported'|'promising'|'speculative';tradeoff:string};
export type VisibilityResult={
 version:1;auditedAt:string;verdict:string;context:Omit<VisibilityInput,'copy'|'evidence'>;
 ledger:{originalCopy:string;sha256:string;evidence:VisibilityInput['evidence'];state:'supplied-not-verified'};
 changes:VisibilityChange[];questions:string[];claimsToCheck:string[];warnings:string[];
};
export type VisibilityRun={id:number;projectId:number;userId:number;input:string;status:string;result:VisibilityResult|null;error:string|null;createdAt:string;failureClass?:VisibilityFailureClass|null};
