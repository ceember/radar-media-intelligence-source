export type TextSuggestion = {
  kind: 'brand' | 'person' | 'place' | 'organization' | 'noun phrase';
  label: string;
  alias?: string;
  entityId?: number;
  start: number;
  end: number;
  evidence: string;
  evidenceStart: number;
};

export type TextSuggestions = {
  method: 'compromise@14.18.0';
  language: string | null;
  status: 'suggested' | 'abstained';
  review: 'unreviewed' | 'reviewed' | 'dismissed';
  reason?: string;
  basis: 'title + newline + article text or content';
  inputLength: number;
  truncated: boolean;
  items: TextSuggestion[];
};

export type TriageBatchResult = { saved: number | null; scanned: number; stoppedEarly: boolean };

export function triageBatchMessage(result: TriageBatchResult): string {
  const saved = result.saved === null ? 'Reload to check any saved suggestions.' : `Saved suggestions for ${result.saved} mentions.`;
  return result.stoppedEarly ? `${saved} Batch stopped at its 20-second budget. Generate again for the remaining mentions.` : saved;
}
