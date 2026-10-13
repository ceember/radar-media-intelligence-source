import type {RefreshRun} from '@/lib/refresh-run-store';

export function RefreshRunCounters({runs}:{runs:RefreshRun[]}){
 return <section className="panel mt-5 px-5 py-4">
  <h2 className="text-sm font-semibold text-slate-300">Refresh Run Counters · Admin Only</h2>
  <p className="mt-2 text-xs text-slate-500">Latest ten runs in this project. Status covers project pipeline stages, not shared retention or lock cleanup. Fetched counts items returned by the connector, before the app’s Boolean/date filters. Duplicate includes within-response and existing archive rows. Quota Skipped counts known local budget decisions that prevent a connector collection, not hypothetical request counts, provider errors or missing configuration. Elapsed is collector-group wall time, including pacing; connectors may run in parallel. Provider-internal filtering is not measured.</p>
  {runs.length===0&&<p className="mt-3 text-xs text-slate-400">No recorded runs. Older Refreshes have no reconstructed counters.</p>}
  {runs.map(run=><details key={run.id} className="mt-3 rounded border border-[var(--border)] p-3 text-xs">
   <summary className="break-words">Run {run.id} · {run.trigger} · {run.status} · {run.startedAt}</summary>
   <p className="mt-2">Finished: {run.finishedAt??'Not completed; observations may be partial.'}</p>
   {run.status==='failed'&&<p className="mt-2">This run failed. Counters record observed stages only and may be partial; no cause is inferred from zero counts.</p>}
   {run.counters.length===0?<p className="mt-2">No connector jobs recorded; this does not prove sources were empty.</p>:<ul className="mt-2 space-y-2">{run.counters.map(counter=><li key={counter.connector} className="break-words">{counter.connector} · Fetched {counter.fetched} · Filtered {counter.filtered} · Duplicate {counter.duplicate} · Inserted {counter.inserted} · Quota Skipped {counter.quota_skipped} · Error {counter.error} · Elapsed {counter.elapsed_ms} ms</li>)}</ul>}
  </details>)}
 </section>;
}
