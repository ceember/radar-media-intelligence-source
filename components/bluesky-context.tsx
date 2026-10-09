'use client';

import { useState } from 'react';
import { BLUESKY_CONTEXT_LABELS, type SavedBlueskyContext } from '@/lib/bluesky-context-types';

export function BlueskyContext({ mentionId,projectId,canWrite }: { mentionId: number; projectId: number; canWrite: boolean }) {
  const [open,setOpen] = useState(false);
  const [busy,setBusy] = useState(false);
  const [context,setContext] = useState<SavedBlueskyContext | null>(null);
  const [message,setMessage] = useState('');
  async function read(refresh: boolean) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(refresh ? '/api/bluesky/context'
        : `/api/bluesky/context?projectId=${projectId}&mentionId=${mentionId}`,refresh ? {
        method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ projectId,mentionIds:[mentionId] }),
      } : { cache:'no-store' });
      const result = await response.json();
      const saved = refresh ? result.contexts?.find((entry: SavedBlueskyContext) => entry.mentionId===mentionId) : result.context;
      setContext(saved ?? null);
      setMessage(result.error ?? (saved ? BLUESKY_CONTEXT_LABELS[saved.reason as keyof typeof BLUESKY_CONTEXT_LABELS]
        : result.reason==='rate_limited' ? BLUESKY_CONTEXT_LABELS.rate_limited
          : result.reason==='time_limit' ? 'Reading stopped at the time limit. Reload saved context before another action.' : 'No saved public context.'));
    } catch { setMessage('Context could not be read. Reload saved status before trying again.'); }
    finally { setBusy(false); }
  }
  return <div className="rounded-lg border border-[var(--border)] px-4 py-3 text-xs text-slate-400">
    <button type="button" aria-expanded={open} disabled={busy} onClick={() => {
      setOpen(!open);
      if (!open) void read(false);
    }} className="text-sky-300">Public Bluesky Context</button>
    {open && <div className="mt-3">
      <p>Public read endpoint only, without login. One parent, quote context and up to 20 direct replies; these are related context, not new independent mentions or complete market coverage. No PDS, firehose, SDK, media downloads or AI calls.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => void read(false)} className="rounded border border-[var(--border)] px-3 py-2 disabled:opacity-50">Reload Saved Context</button>
        {canWrite && <button type="button" disabled={busy || Boolean(context && !context.expired)} onClick={() => void read(true)} className="rounded bg-sky-500 px-3 py-2 text-slate-950 disabled:opacity-50">Read Public Thread</button>}
      </div>
      <p className="mt-2">Cache: 24 hours per stored post/project, including unavailable or failed reads. Maximum five selected posts per API action. A 429 stops the batch and pauses deployment reads for one hour. No fallback or retry.</p>
      {!canWrite && <p className="mt-2">Only the project owner or an admin can request new public context. Shared readers can inspect saved context.</p>}
      {context && <div className="mt-3 break-words">
        <p>Attempted: {context.attemptedAt}. Cache Expires: {context.expiresAt}.</p>
        {context.expired && <p>Expired observations, not current conversation or moderation state. Refresh explicitly when permitted.</p>}
        {context.snapshot && <>
          <p>Observed: {context.snapshot.observedAt}. Publisher dates are not inferred.</p>
          {context.snapshot.truncated && <p>Context truncated at the reply/depth bounds. Additional replies were not followed.</p>}
          {context.snapshot.nodes.length===0 && <p>No usable parent, quote or direct reply context was returned.</p>}
          <ul className="mt-2 space-y-2">
            {context.snapshot.nodes.map(node => <li key={node.uri} className="rounded border border-[var(--border)] p-3">
              <a href={node.url} target="_blank" rel="noopener noreferrer" className="text-sky-300">{({ parent:'Parent',reply:'Reply',quote:'Quote' })[node.relation]}</a>
              {node.status==='visible' ? <>
                {node.author && <p className="mt-1">{node.author}</p>}
                <p className="mt-1 whitespace-pre-line break-words">{node.excerpt}</p>
              </> : <p className="mt-1">{node.status==='moderated' ? 'Moderated context withheld.' : 'Deleted, blocked or unavailable context; no excerpt retained.'}</p>}
            </li>)}
          </ul>
        </>}
      </div>}
      <p role="status" aria-live="polite" className="mt-3">{busy ? 'Reading…' : message}</p>
    </div>}
  </div>;
}
