'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FeedSelectors } from '@/lib/feed-from-page';

export type FeedSettingsSource = {
  name: string; url: string; selectors: FeedSelectors; status: string;
  error: string | null; parser: string; checkedAt: string | null; nextFetchAt: string | null;
};

const inputClass = 'mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm';

export function PageFeedSettings({ projectId, canWrite, source }: {
  projectId: number; canWrite: boolean; source: FeedSettingsSource | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function request(payload: Record<string, unknown>) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/feeds/page', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, projectId }),
      });
      const result = await response.json();
      setMessage(response.ok ? payload.action === 'save' ? 'Saved. Refresh explicitly to read the approved page.'
        : `Ready: ${result.items} public observations.` : result.error ?? 'Publisher feed request failed.');
      router.refresh();
    } catch { setMessage('Publisher feed request failed. Reload to check its status before retrying.'); }
    finally { setBusy(false); }
  }
  return <section className="panel mb-5 px-5 py-4">
    <h2 className="mb-2 text-sm font-semibold">Public Publisher Feed</h2>
    <p className="mb-3 text-xs text-slate-400">One reviewed static publisher page per project, 20 sources per deployment. Basic CSS selectors only; up to 50 same-origin articles. Manual refresh only, once per hour. No login, social bridges, scripts, proxies or paid services.</p>
    {source && <div className="mb-3 break-words text-xs text-slate-400">
      <p>Status: {source.status}. Parser: {source.parser}</p>
      {source.checkedAt && <p>Last Checked: {source.checkedAt}</p>}
      {source.nextFetchAt && <p>Next Refresh: {source.nextFetchAt}</p>}
      {source.error && <p role="status">{source.error}</p>}
    </div>}
    <form onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void request({ action: 'save', name: data.get('name'), url: data.get('url'),
        selectors: Object.fromEntries(['item','link','title','summary'].map(field => [field,data.get(field)])),
        permission: data.get('permission') === 'on' });
    }} className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs">Publisher Name<input name="name" required maxLength={200} defaultValue={source?.name} className={inputClass} disabled={!canWrite || busy} /></label>
      <label className="text-xs">Approved HTTPS Page<input name="url" type="url" required maxLength={2000} defaultValue={source?.url} className={inputClass} disabled={!canWrite || busy} /></label>
      {(['item','link','title','summary'] as const).map(field => <label key={field} className="text-xs capitalize">{field} Selector<input name={field} required maxLength={120} defaultValue={source?.selectors[field] ?? ({ item: 'article', link: 'a', title: 'h2', summary: 'p' })[field]} className={inputClass} disabled={!canWrite || busy} /></label>)}
      <label className="flex items-start gap-2 text-xs sm:col-span-2"><input name="permission" type="checkbox" required disabled={!canWrite || busy} />I reviewed this publisher’s terms and confirm this public static page permits automated reading at the hourly interval. Robots must also allow it; a feed grants no additional permission.</label>
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button type="submit" disabled={!canWrite || busy} className="rounded-lg bg-sky-500 px-4 py-2 text-sm text-slate-950 disabled:opacity-50">Save Approved Source</button>
        <button type="button" disabled={!canWrite || busy || !source} onClick={() => void request({ action: 'refresh' })} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-50">Refresh Public Page</button>
      </div>
    </form>
    {!canWrite && <p className="mt-2 text-xs">Only the project owner or an admin may configure and refresh this source.</p>}
    <p role="status" aria-live="polite" className="mt-3 text-xs">{busy ? 'Working…' : message}</p>
    {source?.status === 'ready' && <div className="mt-3 flex flex-wrap gap-4 text-sm">
      {['rss','atom','json'].map(format => <a key={format} href={`/api/feeds/generated?projectId=${projectId}&format=${format}`} className="text-sky-300">{format.toUpperCase()} Export</a>)}
    </div>}
    <p className="mt-3 text-xs text-slate-500">Exports contain only observations from the current successful refresh, never private imports. Published dates are unknown; observation dates are labelled. Exports use the current project session, not public subscriber tokens. Source edits do not reset the hourly limit. Failed reads retain history but disable exports until a successful refresh.</p>
  </section>;
}
