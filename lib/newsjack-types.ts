export type NewsjackMode = 'opportunities' | 'angles' | 'review';
export type NewsjackProfile = {
  standing: string; topics: string[]; competitors: string[];
  proofAssets: { title: string; url: string }[]; spokespeople: string[];
};
export type NewsjackSource = {
  id: number; title: string; url: string | null; text: string;
  publishedAt: string | null; checkedAt: string; read: boolean; storyId?: number; byline?:string|null; publisher?:string|null;
};
export type NewsjackStory = {
  id: number; title: string; url: string; source: string; text: string; publishedAt: string;
};
export type NewsjackOpportunity = NewsjackStory & {
  freshness: string; firstLocatedAt: string | null; originUrl: string | null;
  standing: string; route: 'Pitch Now' | 'Watch' | 'Big News'; reason: string;
};
export type NewsjackBlock = { title: string; text: string; sourceIds: number[] };
export type NewsjackClaim = {
  claim: string; status: 'supported' | 'stated' | 'contradicted' | 'missing-source';
  reason: string; sourceId: number | null; evidenceQuote: string;
};
export type ReporterSelectionDiagnostic = {
  sourceId:number|null; quote:string;
  eligibility:'eligible'|'anchor-unresolved'|'no-valid-selection'|'title-only'|'non-body-quote'|'topic-mismatch';
  reason:string;
};
export type ReporterParseStatus='no-response'|'invalid-json'|'fenced-json'|'invalid-schema'|'unknown-id'|'duplicate-id'|'empty-selection'|'missing-source'|'parsed';
export type ReporterSchemaErrorRule='required'|'type'|'enum'|'max-length'|'max-items'|'additional-properties'|'response-size';
export type ReporterSchemaError={field:string;rule:ReporterSchemaErrorRule};
export type ReporterParseDiagnostic={status:ReporterParseStatus;expectedSourceIds:number[];errors?:ReporterSchemaError[]};
export type NewsjackResult = {
  opportunities: NewsjackOpportunity[]; blocks: NewsjackBlock[]; claims: NewsjackClaim[];
  sources: NewsjackSource[]; warnings: string[];
  factCheck?: 'complete' | 'empty' | 'incomplete';
  notChecked?: string[];
  outcome?: 'insufficient-facts';
  crisis?: {issuedAt:string;validUntil:string};
  reporterDiagnostics?: ReporterSelectionDiagnostic[];
  reporterParse?: ReporterParseDiagnostic;
  reviewDiagnostics?: import('./newsjack-review-diagnostics').ReviewDiagnostics;
};
export type NewsjackSavedRun = {
  id: number; mode: NewsjackMode; status: string; input: string;
  result: NewsjackResult | null; error: string | null; createdAt: string;
};
