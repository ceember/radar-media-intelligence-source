'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export function CompetitorControls({ projectId, pageId, canSeed = false, seedLabel = 'Select Configured Public Pages' }: { projectId: number; pageId?: number; canSeed?: boolean; seedLabel?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function send(body: Record<string, unknown>, capture = false) {
    if (busy) return;
    setBusy(true); setMessage(capture ? 'Checking robots policy and capturing this public page…' : 'Saving selection…');
    try {
      const response = await fetch(`/api/competitors/${capture ? 'capture' : 'pages'}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, projectId }) });
      const value = await response.json();
      setMessage(value.error ?? value.message ?? 'Saved.');
      router.refresh();
    } catch { setMessage('Request interrupted. Reload to check the saved history before retrying.'); }
    finally { setBusy(false); }
  }
  function select(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void send({ entity: data.get('entity'), label: data.get('label'), url: data.get('url') });
  }
  const button = 'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50';
  return <div className="min-w-0 space-y-3">
    {pageId ? <button className={button} disabled={busy} onClick={() => void send({ pageId }, true)}>{busy ? 'Capturing…' : 'Capture Public Page'}</button>
      : <><form onSubmit={select} className="flex min-w-0 flex-wrap items-end gap-3">
        {(['entity', 'label', 'url'] as const).map((name) => <label key={name} className={`min-w-0 ${name === 'url' ? 'w-full sm:flex-1' : 'flex-1'}`}>
          <span className="mb-1 block text-xs text-slate-400">{name === 'entity' ? 'Brand' : name === 'label' ? 'Page Label' : 'Public HTTPS URL'}</span>
          <input required type={name === 'url' ? 'url' : 'text'} name={name} maxLength={name === 'url' ? 1800 : 120}
            placeholder={name === 'url' ? 'https://example.com/packages' : undefined} className="w-full min-w-0 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-200" />
        </label>)}
        <button className={button} disabled={busy}>Select Page</button>
      </form>{canSeed && <button className={button} disabled={busy} onClick={() => void send({ action: 'seed' })}>{seedLabel}</button>}</>}
    <p role="status" className="break-words text-sm text-slate-400">{message}</p>
  </div>;
}
