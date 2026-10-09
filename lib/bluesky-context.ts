import { cleanStoredText } from './text-clean';
import type { BlueskyContextNode, BlueskyContextSnapshot, BlueskyRelation } from './bluesky-context-types';

export const BLUESKY_PUBLIC_HOST = 'public.api.bsky.app';
const THREAD_TYPE = 'app.bsky.feed.defs#threadViewPost';
const POST_TYPE = 'app.bsky.feed.post';

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function blueskyPostUri(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 600) return null;
  const match = value.match(/^at:\/\/(did:plc:[a-z2-7]{24}|did:web:[A-Za-z0-9.-]+(?::[A-Za-z0-9._-]+)*)\/app\.bsky\.feed\.post\/([A-Za-z0-9._~:-]{1,128})$/);
  return match && !['.','..'].includes(match[2]) ? value : null;
}

export function blueskyPostUrl(uri: string): string {
  if (!blueskyPostUri(uri)) throw new Error('Unsupported Bluesky post URI.');
  const [repository,,key] = uri.slice(5).split('/');
  return `https://bsky.app/profile/${encodeURIComponent(repository)}/post/${encodeURIComponent(key)}`;
}

export function blueskyThreadEndpoint(uri: string): string {
  if (!blueskyPostUri(uri)) throw new Error('Unsupported Bluesky post URI.');
  const endpoint = new URL(`https://${BLUESKY_PUBLIC_HOST}/xrpc/app.bsky.feed.getPostThread`);
  endpoint.searchParams.set('uri',uri);
  endpoint.searchParams.set('depth','1');
  endpoint.searchParams.set('parentHeight','1');
  return endpoint.href;
}

function moderated(post: Record<string, unknown>,record: Record<string, unknown> | null): boolean {
  const author = object(post.author),viewer = object(author?.viewer),postViewer = object(post.viewer);
  const selfLabels = object(record?.labels);
  const signals = [post.labels,author?.labels,selfLabels?.values];
  return (record?.labels !== undefined && (!selfLabels || !Array.isArray(selfLabels.values)))
    || signals.some(value => value !== undefined && (!Array.isArray(value) || value.length > 0))
    || Boolean(viewer?.blocking || viewer?.blockedBy || viewer?.muted || postViewer?.blocked || postViewer?.threadMuted);
}

function postNode(raw: unknown,relation: BlueskyRelation): BlueskyContextNode | null {
  const post = object(raw),uri = blueskyPostUri(post?.uri);
  if (!post || !uri) return null;
  const base = { uri,url:blueskyPostUrl(uri),relation,excerpt:null,author:null };
  const record = object(post.record ?? post.value),author = object(post.author);
  if (moderated(post,record)) return { ...base,status:'moderated' };
  if (!record || record.$type !== POST_TYPE || typeof record.text !== 'string'
    || author?.did !== uri.slice(5).split('/')[0]) return { ...base,status:'unavailable' };
  const excerpt = cleanStoredText(record.text,1000);
  if (!excerpt) return { ...base,status:'unavailable' };
  const name = typeof author?.displayName === 'string' ? author.displayName
    : typeof author?.handle === 'string' ? author.handle : '';
  return { ...base,status:'visible',excerpt,author:cleanStoredText(name,100) || null };
}

function threadNode(raw: unknown,relation: BlueskyRelation): BlueskyContextNode | null {
  const thread = object(raw);
  if (thread?.$type === THREAD_TYPE) return postNode(thread.post,relation);
  const uri = blueskyPostUri(thread?.uri);
  if (uri && ['app.bsky.feed.defs#blockedPost','app.bsky.feed.defs#notFoundPost'].includes(String(thread?.$type))) {
    return { uri,url:blueskyPostUrl(uri),relation,status:'unavailable',excerpt:null,author:null };
  }
  return null;
}

export function readBlueskyThread(value: unknown,rootUri: string,observedAt: string): BlueskyContextSnapshot {
  if (!blueskyPostUri(rootUri) || !Number.isFinite(Date.parse(observedAt))) throw new Error('Invalid Bluesky context input.');
  const thread = object(object(value)?.thread),rootPost = object(thread?.post);
  const snapshot: BlueskyContextSnapshot = { rootUri,observedAt:new Date(observedAt).toISOString(),status:'unavailable',nodes:[],truncated:false };
  if (thread?.$type !== THREAD_TYPE) {
    if (thread?.uri === rootUri && ['app.bsky.feed.defs#blockedPost','app.bsky.feed.defs#notFoundPost'].includes(String(thread.$type))) return snapshot;
    throw new Error('Invalid Bluesky thread.');
  }
  if (rootPost?.uri !== rootUri) throw new Error('Invalid Bluesky thread.');
  if (thread.replies !== undefined && !Array.isArray(thread.replies)) throw new Error('Invalid Bluesky thread.');
  const root = postNode(rootPost,'reply');
  if (!root || root.status === 'unavailable') return snapshot;
  if (root.status === 'moderated') return { ...snapshot,status:'moderated' };
  const nodes = new Map<string,BlueskyContextNode>();
  const add = (node: BlueskyContextNode | null) => {
    if (!node || node.uri === rootUri) return;
    const previous = nodes.get(node.uri);
    const severity = { visible:0,unavailable:1,moderated:2 };
    if (!previous || severity[node.status] > severity[previous.status]) nodes.set(node.uri,{ ...node,relation:previous?.relation ?? node.relation });
  };
  const record = object(rootPost.record),parentUri = blueskyPostUri(object(object(record?.reply)?.parent)?.uri);
  const parent = threadNode(thread.parent,'parent');
  if (parent && parent.uri === parentUri) add(parent);
  const embed = object(rootPost.embed);
  const quote = embed?.$type === 'app.bsky.embed.record#view' ? object(embed.record)
    : embed?.$type === 'app.bsky.embed.recordWithMedia#view' ? object(object(embed.record)?.record) : null;
  if (quote?.$type === 'app.bsky.embed.record#viewRecord') add(postNode(quote,'quote'));
  if (quote && ['app.bsky.embed.record#viewBlocked','app.bsky.embed.record#viewNotFound','app.bsky.embed.record#viewDetached'].includes(String(quote.$type))) {
    const uri = blueskyPostUri(quote.uri);
    if (uri) add({ uri,url:blueskyPostUrl(uri),relation:'quote',status:'unavailable',excerpt:null,author:null });
  }
  const replies = Array.isArray(thread.replies) ? thread.replies : [];
  for (const reply of replies) {
    const entry = object(reply),node = threadNode(reply,'reply');
    if (entry?.$type === THREAD_TYPE) {
      const replyPost = object(entry.post),replyRecord = object(replyPost?.record);
      if (object(object(replyRecord?.reply)?.parent)?.uri !== rootUri) continue;
      if (Array.isArray(entry.replies) && entry.replies.length > 0) snapshot.truncated = true;
    }
    add(node);
  }
  let replyCount = 0;
  const bounded = [...nodes.values()].filter(node => {
    if (node.relation !== 'reply') return true;
    replyCount++;
    if (replyCount <= 20) return true;
    snapshot.truncated = true;
    return false;
  });
  return { ...snapshot,status:'ready',nodes:bounded };
}

export function blueskyMentionIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5
    || value.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(value).size !== value.length) {
    throw new Error('Select one to five distinct Bluesky mentions.');
  }
  return value;
}
