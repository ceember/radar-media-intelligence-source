'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { triageBatchMessage, type TextSuggestions as Suggestions } from '@/lib/text-triage-types';

const BUTTON = 'rounded-lg bg-sky-500/90 px-3 py-2 font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-60';

export function GenerateTextSuggestions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function generate() {
    setBusy(true);
    try {
      const res = await fetch('/api/text-suggestions', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Generation failed.');
      setMessage(triageBatchMessage(result));
      router.refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Generation failed.'); }
    finally { setBusy(false); }
  }
  return <div className="mb-4 text-xs text-slate-400"><button className={BUTTON} disabled={busy} onClick={generate}>
    {busy ? 'Generating…' : 'Generate English Suggestions'}</button>
    <span className="ml-3">Up to 100 mentions within a 20-second batch budget. Rules-based; no AI charge.</span><p role="status">{message}</p></div>;
}

export function TextSuggestions({ suggestions: s, mentionId, canReview }: { suggestions: Suggestions; mentionId: number; canReview: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function review(value: Suggestions['review']) {
    setBusy(true);
    try {
      const res = await fetch('/api/text-suggestions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mentionId, review: value }) });
      if (!res.ok) throw new Error('Review could not be saved.');
      router.refresh();
      setMessage('Review saved.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Review failed.'); }
    finally { setBusy(false); }
  }
  return <details className="mt-3 break-words rounded border border-white/10 p-3 text-xs text-slate-400">
    <summary className="cursor-pointer text-sky-300">Rules-Based Suggestions · {s.review} · {s.items.length}</summary>
    <p className="my-2">English rules can misidentify names and noun phrases. Suggestions do not change sentiment or AI topics. Evidence quotes the original text.</p>
    {s.reason && <p>{s.reason}</p>}
    {s.truncated && <p>Only the first 20,000 characters were considered.</p>}
    <ul className="space-y-2">{s.items.map((i, n) => <li key={n}><strong className="text-slate-200">{i.label}</strong> · {i.kind}
      {i.alias && <span> · alias: {i.alias}</span>}<blockquote className="mt-1 border-l-2 border-sky-500/40 pl-2">{i.evidence}</blockquote>
      <span className="text-[10px]">Original text characters {i.start}–{i.end} · {s.method}</span></li>)}</ul>
    {canReview && s.status === 'suggested' && <div className="mt-3 flex gap-2">{(['reviewed', 'dismissed', 'unreviewed'] as const).map(value =>
      <button key={value} className={BUTTON} disabled={busy || s.review === value} onClick={() => review(value)}>{value === 'reviewed' ? 'Mark Reviewed' : value === 'dismissed' ? 'Dismiss' : 'Reset Review'}</button>)}</div>}
    <p role="status">{message}</p>
  </details>;
}
