import type { CompetitorSnapshot } from '@/lib/competitor-page';
import { compareStructuredOffers } from '@/lib/competitor-offers';
import { offerFieldLabels } from '@/lib/competitor-offer-input';
import type { OfferReview } from '@/lib/competitor-offer-reviews';
import { CompetitorOfferReview } from './competitor-offer-review';

const stamp = (value: string) => new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' SAST';
const display = (value: unknown) => value === null || value === undefined ? 'Unknown' : value === true ? 'Yes' : value === false ? 'No' : String(value);
export function CompetitorOffers({ projectId, current, previous, canWrite, reviews }: { projectId: number; current?: CompetitorSnapshot; previous?: CompetitorSnapshot; canWrite: boolean; reviews: OfferReview[] }) {
  const offers = current?.status === 'ok' ? current.offers : null;
  const difference = compareStructuredOffers(previous?.offers, offers);
  return <div className="min-w-0 space-y-3 border-t border-white/10 pt-4">
    <h4 className="font-semibold text-slate-100">Structured Offers And Changes</h4>
    <p className="text-xs text-slate-400">Published Schema.org JSON-LD from this static capture. Publisher markup can be stale. Displayed prices, eligibility and checkout have not been validated. No AI inference.</p>
    <p className="text-sm text-slate-300">{offers?.status === 'published' ? 'Published Structured Offers' : offers?.status === 'not_published' ? 'Not Published In Supported JSON-LD' : offers?.status === 'ambiguous' ? 'Ambiguous — Review Evidence' : 'Unknown — Capture This Page To Read Structured Offers'}</p>
    {offers?.warnings.map((warning, i) => <p key={i} className="break-words text-xs text-amber-300">{warning}</p>)}
    {offers && <p className="text-xs text-slate-500">{offers.method} · {current && stamp(current.capturedAt)} · maximum 20 offers</p>}
    {difference.status === 'baseline' && <p className="text-xs text-slate-400">First structured baseline; no earlier structured evidence.</p>}
    {difference.status === 'unchanged' && <p className="text-xs text-slate-400">Published structured fields unchanged since {previous && stamp(previous.capturedAt)}.</p>}
    {difference.status === 'unknown' && <p className="text-xs text-slate-400">Automatic changes unknown: both captures need supported, unambiguous offers with explicit identifiers.</p>}
    {difference.status === 'changed' && <div className="overflow-x-auto"><p className="mb-2 text-xs text-slate-400">Publisher fields compared with {previous && stamp(previous.capturedAt)}. Missing values are Unknown; a missing entry means absent from markup.</p><table className="w-full text-left text-xs"><thead><tr className="text-slate-400"><th className="p-2">Plan / Field</th><th className="p-2">Before</th><th className="p-2">After</th></tr></thead><tbody>{difference.changes.map((change, i) => <tr key={i} className="border-t border-white/10 text-slate-300"><td className="break-words p-2">{change.name} · {offerFieldLabels[change.field as keyof typeof offerFieldLabels] ?? change.field}</td><td className="break-words p-2">{display(change.before)}</td><td className="break-words p-2">{display(change.after)}</td></tr>)}</tbody></table></div>}
    <div className="grid min-w-0 gap-3 xl:grid-cols-2">{offers?.offers.map(offer => {
      const corrections = reviews.filter(r => r.snapshotId === current?.id && r.offerId === offer.id).sort((a, b) => b.id - a.id);
      const priceCorrection = corrections.find(r => r.field === 'price');
      const ambiguous = offers.status !== 'published' || !offer.stableIdentity || Object.values(offer.conflicts ?? {}).some(values => values.length > 1);
      return <div key={offer.id} className="min-w-0 space-y-3 rounded-lg border border-white/10 p-3">
      <h5 className="break-words font-medium text-slate-200">{offer.name}</h5><p className="text-xs text-slate-500">{offer.kind} · {offer.stableIdentity ? 'Explicit Publisher Identifier' : 'Identity Ambiguous'}</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">{Object.entries(offerFieldLabels).flatMap(([field, label]) => {
        const key = field as keyof typeof offerFieldLabels, value = offer.fields[key];
        const candidates = offer.conflicts?.[key] ?? (ambiguous && value !== null ? [{ value, evidence: offer.evidence[key] }] : []);
        return candidates.length ? candidates.map((candidate, i) => <div key={`${field}-${i}`} className="min-w-0"><dt className="text-amber-300">Candidate {label} - Human Review Required</dt><dd className="break-words text-slate-300">{display(candidate.value)}</dd></div>) : [<div key={field} className="min-w-0"><dt className="text-slate-500">{label}</dt><dd className="break-words text-slate-300">{display(value)}</dd></div>];
      })}</dl>
      {priceCorrection?.correctedValue !== null && priceCorrection?.correctedValue !== undefined && <div className="space-y-1 border-t border-white/10 pt-2 text-xs text-amber-200"><p className="break-words">Human-Confirmed Price: {priceCorrection.correctedValue}</p><p>{stamp(priceCorrection.createdAt)} · recorded by a person; captured candidates remain unchanged.</p></div>}
      <details className="text-xs text-slate-400"><summary>Field Source Evidence</summary><p className="mt-2">Paths refer to JSON-LD scripts in the captured HTML. Text excerpts are limited to 120 characters.</p>{Object.entries(offer.evidence).map(([field, evidence]) => <p key={field} className="mt-2 break-all">{field} · {evidence.path} · {display(evidence.value)}</p>)}{Object.entries(offer.conflicts ?? {}).flatMap(([field, candidates]) => candidates.map((candidate, i) => <p key={`${field}-${i}`} className="mt-2 break-all">Candidate {offerFieldLabels[field as keyof typeof offerFieldLabels]} - Human Review Required · {candidate.evidence.path} · {display(candidate.evidence.value)}</p>))}</details>
      {corrections.map(r => <div key={r.id} className="space-y-1 border-t border-white/10 pt-2 text-xs text-amber-200"><p>Human Correction · {stamp(r.createdAt)}</p><p className="break-words">{offerFieldLabels[r.field]}: {display(r.correctedValue)}</p><p className="break-words">{r.note}</p></div>)}
      {canWrite && current && <CompetitorOfferReview projectId={projectId} snapshotId={current.id} offerId={offer.id} />}
    </div>; })}</div>
  </div>;
}
