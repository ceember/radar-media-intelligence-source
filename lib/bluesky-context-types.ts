export type BlueskyRelation = 'parent' | 'reply' | 'quote';
export type BlueskyContextNode = {
  uri: string;
  url: string;
  relation: BlueskyRelation;
  status: 'visible' | 'unavailable' | 'moderated';
  excerpt: string | null;
  author: string | null;
};
export type BlueskyContextSnapshot = {
  rootUri: string;
  observedAt: string;
  status: 'ready' | 'unavailable' | 'moderated';
  nodes: BlueskyContextNode[];
  truncated: boolean;
};
export type BlueskyContextReason = 'reading' | 'ready' | 'thread_unavailable' | 'moderated' | 'invalid_thread' | 'fetch_failed' | 'rate_limited';
export type SavedBlueskyContext = {
  mentionId: number;
  status: 'reading' | 'ready' | 'unavailable' | 'moderated' | 'throttled';
  reason: BlueskyContextReason;
  snapshot: BlueskyContextSnapshot | null;
  attemptedAt: string;
  expiresAt: string;
  expired: boolean;
};
export const BLUESKY_CONTEXT_LABELS: Record<BlueskyContextReason, string> = {
  reading: 'Public context reading started. Reload to check its saved status.',
  ready: 'Saved public conversation context, not independent mentions.',
  thread_unavailable: 'The public thread is deleted, blocked or unavailable.',
  moderated: 'Context withheld because public moderation signals are present.',
  invalid_thread: 'The public response did not match this stored post or supported thread shape.',
  fetch_failed: 'Public context could not be read. No login, fallback or retry was attempted.',
  rate_limited: 'Bluesky rate limited reading. This batch stopped; no retry was attempted.',
};
