'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { offerFieldLabels } from '@/lib/competitor-offer-input';

export function CompetitorOfferReview({ projectId, snapshotId, offerId }: { projectId: number; snapshotId: number; offerId: string }) {
  const router = useRouter(), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const input = 'w-full min-w-0 rounded border border-white/10 bg-slate-950 p-2 text-sm text-slate-200';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/competitors/offers/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        projectId, snapshotId, offerId, field: data.get('field'), correctedValue: data.get('correctedValue') || null, note: data.get('note'),
      }) });
      const result = await response.json(); setMessage(result.message ?? result.error ?? 'Result unknown. Reload to check.');
      if (response.ok) { form.reset(); router.refresh(); }
    } catch { setMessage('Result unknown. Reload before submitting again.'); } finally { setBusy(false); }
  }
  return <details className="text-sm text-slate-400"><summary>Record A Human Correction</summary>
    <form onSubmit={submit} className="mt-3 grid min-w-0 gap-3">
      <p className="text-xs">Record what you checked on the public page. Captured publisher values and automatic comparisons remain unchanged.</p>
      <label>Field<select className={input} name="field">{Object.entries(offerFieldLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Corrected Value (Blank Means Unknown)<input className={input} name="correctedValue" maxLength={100} /></label>
      <label>Evidence And Reason<textarea className={input} name="note" maxLength={400} required rows={2} /></label>
      <button disabled={busy} className="justify-self-start rounded border border-sky-400/30 px-3 py-2 text-sm text-sky-300 disabled:opacity-50">{busy ? 'Saving…' : 'Save Human Correction'}</button>
      <p role="status" className="break-words text-xs text-slate-300">{message}</p>
    </form>
  </details>;
}
