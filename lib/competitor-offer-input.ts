import { cleanStoredText } from './text-clean';

export const offerFieldLabels = {
  price: 'Price', lowPrice: 'Lowest Published Price', highPrice: 'Highest Published Price', currency: 'Currency',
  billingPeriod: 'Price Per Period', contractLength: 'Billing Duration', setupFee: 'Setup Fee', setupCurrency: 'Setup Currency',
  vatIncluded: 'VAT Included', downloadSpeed: 'Download Speed', uploadSpeed: 'Upload Speed',
} as const;
export type OfferReviewInput = { snapshotId: number; offerId: string; field: keyof typeof offerFieldLabels; correctedValue: string | null; note: string };
export function parseOfferReview(value: unknown): OfferReviewInput {
  const v = value as Partial<OfferReviewInput> | null;
  if (!v || !Number.isSafeInteger(v.snapshotId) || Number(v.snapshotId) < 1 || typeof v.offerId !== 'string' || !/^[a-f0-9]{64}$/.test(v.offerId) ||
    typeof v.field !== 'string' || !Object.hasOwn(offerFieldLabels, v.field)) throw Error('Select a captured offer and field.');
  const text = (input: unknown, max: number) => {
    if (typeof input !== 'string' || [...input].length > max) throw Error(`Enter text up to ${max} characters.`);
    return cleanStoredText(input).trim();
  };
  const note = text(v.note, 400);
  if (!note) throw Error('Explain the correction and the public evidence you checked.');
  return { snapshotId: v.snapshotId!, offerId: v.offerId, field: v.field, correctedValue: v.correctedValue === null ? null : text(v.correctedValue, 100) || null, note };
}
