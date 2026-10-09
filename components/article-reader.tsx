'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReaderState } from '@/lib/article-reader-fallback';
import { readerReasonLabel } from '@/lib/article-reader-reasons';

const LABELS: Record<ReaderState['status'], string> = {
  reading: 'Reading started; reload to check or try again after 60 seconds.',
  native: 'Read from the publisher.', read: 'Read with Jina Reader.',
  unavailable: 'Reading unavailable. Open the original page.',
  restricted: 'Reading stopped: this page has an access barrier.',
  throttled: 'Reading limit reached. Wait 6 seconds; daily limits reset at midnight UTC.',
};

export function ArticleReader({ id, projectId, state }: { id: number; projectId: number; state?: ReaderState | null }) {
  const [open, setOpen] = useState(false), [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(state ? readerReasonLabel(state.reason)||LABELS[state.status] : '');
  const router = useRouter();
  async function read() {
    setBusy(true); setMessage('Reading the public page…');
    try {
      const response = await fetch('/api/articles/read', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mentionId: id, projectId, permission }) });
      const result = await response.json();
      setMessage(result.error || readerReasonLabel(result.reason) || LABELS[result.status as ReaderState['status']] || 'Reading unavailable.');
      router.refresh();
    } catch { setMessage('Reading unavailable. Try again later.'); }
    finally { setBusy(false); }
  }
  return <div className="mt-2 text-xs text-slate-400">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="rounded px-1.5 py-1 text-sky-400 hover:bg-white/5">Read Public Page</button>
    {open && <div className="mt-2 rounded-lg border border-[var(--border)] p-3">
      <p>Try the publisher first. If rendering is needed, Jina Reader receives this public URL. No account or paid API is used.</p>
      <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={permission} onChange={e => setPermission(e.target.checked)} />
        <span>I have permission to read and forward this public page under its source terms. It has no private data, login, paywall or CAPTCHA.</span></label>
      <button type="button" onClick={read} disabled={!permission || busy} className="btn-primary mt-3 text-xs disabled:opacity-40">{busy ? 'Reading…' : 'Read This Article'}</button>
      <p className="mt-2 text-slate-500">Jina limit: 100 requests per day across Radar, one every 6 seconds. One article per action.</p>
    </div>}
    {message && <p role="status" className="mt-1">{message}</p>}
  </div>;
}
