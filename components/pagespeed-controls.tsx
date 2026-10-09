'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PageSpeedStrategy, PageSpeedProvider } from '@/lib/competitor-pagespeed';

export function PageSpeedControls({ projectId, pageId, ownServer = false }: { projectId: number; pageId: number; ownServer?: boolean }) {
  const router = useRouter();
  const [strategy, setStrategy] = useState<PageSpeedStrategy>('mobile'), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [provider, setProvider] = useState<PageSpeedProvider>('google');
  async function audit() {
    if (busy) return;
    setBusy(true); setMessage(provider === 'f9' ? 'Requesting one own-server lab audit (up to 100 seconds)…' : 'Requesting one hosted lab audit…');
    try {
      const response = await fetch('/api/competitors/pagespeed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, pageId, strategy, provider }) });
      const value = await response.json(); setMessage(value.error ?? value.message ?? 'Reload to inspect the saved evidence.'); router.refresh();
    } catch { setMessage('Request interrupted. Reload to check the saved audit before retrying.'); }
    finally { setBusy(false); }
  }
  const field = 'rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-200';
  return <div className="space-y-2"><div className="flex flex-wrap gap-2">
    <select aria-label="Lab audit strategy" className={field} disabled={busy} value={strategy} onChange={e => setStrategy(e.target.value as PageSpeedStrategy)}>
      <option value="mobile">Mobile</option><option value="desktop">Desktop</option>
    </select>
    {ownServer && <select aria-label="Lab audit provider" className={field} disabled={busy} value={provider} onChange={e => setProvider(e.target.value as PageSpeedProvider)}><option value="google">Google PageSpeed</option><option value="f9">Own Server</option></select>}
    <button disabled={busy} onClick={audit} className={`${field} hover:bg-white/10 disabled:opacity-50`}>{busy ? 'Auditing…' : provider === 'f9' ? 'Run Own Server Audit' : 'Run PageSpeed Audit'}</button>
  </div><p role="status" className="break-words text-xs text-slate-400">{message}</p></div>;
}
