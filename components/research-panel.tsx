'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import type { ResearchEvent, ResearchRun, ResearchSource, ResearchFailureCategory } from '@/lib/web-research-types';
import { checkResearchCitations } from '@/lib/web-research';

type HistoryItem = Pick<ResearchRun, 'id' | 'question' | 'status' | 'createdAt'>;

const failureLabels: Record<ResearchFailureCategory, string> = { robots: 'Robots', http_status: 'HTTP Status', timeout: 'Timeout', barrier: 'Access Barrier', non_html: 'Non-HTML', guard: 'Public Reader Guard', network: 'Network' };
export function ResearchReadStatus({ source }: { source: ResearchSource }) {
  return <>{source.status === 'read' ? 'Read · Source Snapshot Saved' : source.error || 'Not Yet Read'}
    {source.failureCategory ? ` · ${failureLabels[source.failureCategory]}${source.httpStatus ? ` ${source.httpStatus}` : ''}` : source.status === 'failed' ? ' · Failure Category Not Recorded' : ''}
    {source.elapsedMs !== undefined && ` · ${source.elapsedMs} ms`}</>;
}

/** React text nodes escape all fetched/model HTML. Only validated source URLs become links. */
function CitedAnswer({ run }: { run: ResearchRun }) {
  try { checkResearchCitations(run.answer, run.sources); }
  catch { return <div className="space-y-2"><p className="text-sm text-amber-300">This saved answer does not meet citation checks. Its citations are unverified.</p>
    <p className="whitespace-pre-wrap text-sm leading-7 text-slate-300">{run.answer}</p></div>; }
  return <div className="whitespace-pre-wrap text-sm leading-7 text-slate-300">{run.answer.split(/(\[\d+\])/g).map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    const source = match && run.sources.find((s) => s.id === Number(match[1]) && s.status === 'read');
    return source ? <a key={i} href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}
      className="mx-0.5 rounded bg-sky-500/15 px-1 text-sky-300 underline decoration-sky-500/40">{part}</a> : <span key={i}>{part}</span>;
  })}</div>;
}

export function ResearchPanel({ projectId, history: initialHistory, enabled, disabledReason }: {
  projectId: number; history: HistoryItem[]; enabled: boolean; disabledReason?: string;
}) {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState(initialHistory);
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sources, setSources] = useState<ResearchRun['sources']>([]);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function refreshHistory() {
    const res = await fetch(`/api/research?projectId=${projectId}`);
    if (res.ok) setHistory((await res.json()).history);
  }

  async function open(id: number) {
    if (busy) return;
    setError(''); setSteps([]);
    try {
      const res = await fetch(`/api/research?projectId=${projectId}&id=${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Saved research could not be opened.');
      setRun(data.run); setSources(data.run.sources);
    } catch (e) { setError((e as Error).message); }
  }

  async function start() {
    if (busy || !enabled || !question.trim()) return;
    setBusy(true); setError(''); setRun(null); setSources([]); setSteps([]);
    const abort = new AbortController(); request.current = abort;
    let terminal = false;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as ResearchEvent;
      if (event.type === 'step') setSteps((s) => [...s, event.message]);
      if (event.type === 'sources') setSources(event.sources);
      if (event.type === 'done') { terminal = true; setRun(event.run); setSources(event.run.sources); }
      if (event.type === 'error') { terminal = true; setError(event.error); }
    };
    try {
      const res = await fetch('/api/research', { method: 'POST', signal: abort.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, projectId }) });
      if (!res.ok) throw new Error((await res.json()).error || 'Research could not start.');
      if (!res.body) throw new Error('Research stream was unavailable.');
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let pending = '';
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split('\n'); pending = lines.pop() || '';
        lines.forEach(consume);
        if (done) { consume(pending); break; }
      }
      if (!terminal) throw new Error('Research was interrupted. Check history for its saved source snapshot.');
    } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
    finally { setBusy(false); if (!abort.signal.aborted) await refreshHistory().catch(() => {}); }
  }

  return <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
    <div className="min-w-0 space-y-4">
      <form className="panel space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <label htmlFor="research-question" className="block text-sm font-medium">Your Question</label>
        <textarea id="research-question" value={question} onChange={(e) => setQuestion(e.target.value)} rows={3}
          maxLength={1600} minLength={3} required disabled={busy || !enabled} placeholder="What do primary sources say about this topic?"
          className="w-full resize-y rounded-lg border border-[var(--border)] bg-black/10 p-3 text-sm outline-none focus:border-sky-500" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-400">Up to 8 sources · 20 runs per day · Resets at 00:00 UTC</p>
          <button type="submit" disabled={busy || !enabled || question.trim().length < 3}
            className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} {busy ? 'Researching…' : 'Start Research'}
          </button>
        </div>
        {!enabled && <p className="text-sm text-amber-300">{disabledReason || 'Research AI is not enabled for this account.'}</p>}
      </form>
      {steps.length > 0 && <ol aria-live="polite" aria-label="Research Progress" className="panel space-y-2 p-4 text-xs text-slate-400">
        {steps.map((step, i) => <li key={i}>{i + 1}. {step}</li>)}
      </ol>}
      {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">{error}</p>}
      {run && <article className="panel space-y-4 p-5">
        <h2 className="break-words text-lg font-semibold">{run.question}</h2>
        <p className="text-xs text-slate-500">Saved {new Date(run.createdAt).toISOString().replace('T', ' ').slice(0, 16)} UTC · {run.status === 'complete' ? 'Complete' : run.status === 'failed' ? 'Failed' : 'Unfinished Run'}</p>
        {run.answer && <CitedAnswer run={run} />}
        {run.error && <p role="alert" className="text-sm text-red-300">{run.error}</p>}
        {run.status === 'running' && <p className="text-sm text-amber-300">This run has not saved a completed answer. It may have been interrupted.</p>}
        {run.warnings.length > 0 && <ul className="space-y-1 text-xs text-amber-300">{run.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      </article>}
      {sources.length > 0 && <section className="panel space-y-3 p-5">
        <h2 className="text-base font-semibold">Sources</h2>
        <ol className="space-y-4">{sources.map((source) => <li key={source.id} className="min-w-0 text-sm">
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="break-words text-sky-300 hover:underline">[{source.id}] {source.title} <ExternalLink className="inline size-3" /></a>
          <p className="mt-1 break-all text-[11px] text-slate-500">{source.url}</p>
          <p className="mt-1 text-xs text-slate-400">Search Provider: {(source.providers ?? ['tavily']).map(p => p === 'f9' ? 'Own Server (f9)' : 'Tavily').join(' · ')}
            {source.reader && ` · Page Reader: ${source.reader === 'native' ? 'Native Extractor' : 'Tavily Extract'}`}</p>
          <p className={`mt-1 text-xs ${source.status === 'failed' ? 'text-amber-300' : 'text-slate-400'}`}>
            <ResearchReadStatus source={source} /></p>
          {source.text && <details className="mt-2 text-xs text-slate-400"><summary className="cursor-pointer">Read Saved Snapshot</summary><p className="mt-2 whitespace-pre-wrap break-words">{source.text}</p></details>}
        </li>)}</ol>
      </section>}
    </div>
    <aside className="panel min-w-0 p-4">
      <h2 className="mb-3 font-semibold">Research History</h2>
      <p className="mb-3 text-xs text-slate-500">Latest 30 runs in this project</p>
      {history.length ? <ul className="space-y-2">{history.map((item) => <li key={item.id}>
        <button disabled={busy} onClick={() => void open(item.id)} className={`w-full rounded-lg border p-3 text-left text-sm hover:bg-white/5 disabled:opacity-50 ${run?.id === item.id ? 'border-sky-500/50' : 'border-[var(--border)]'}`}>
          <span className="block break-words">{item.question}</span>
          <span className="mt-1 block text-[11px] text-slate-500">{item.createdAt.slice(0, 10)} · {item.status}</span>
        </button>
      </li>)}</ul> : <p className="text-sm text-slate-400">Your saved research will appear here.</p>}
    </aside>
  </div>;
}
