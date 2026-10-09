import nlp from 'compromise';
import type { TextSuggestion, TextSuggestions } from './text-triage-types';
import { cleanStoredText } from './text-clean';

export const TRIAGE_LIMIT = 20_000;
export const TRIAGE_BATCH = 100;
export type BrandAlias = { id: number; name: string; keywords: string[] };

/** Offsets refer to the original title + newline + article text (or content), in UTF-16. */
export function suggestText(text: string, language: string | null, brands: BrandAlias[]): TextSuggestions {
  const result: TextSuggestions = {
    method: 'compromise@14.18.0', language: language === null ? null : cleanStoredText(language, 12), status: 'abstained', review: 'unreviewed',
    basis: 'title + newline + article text or content', inputLength: Math.min(text.length, TRIAGE_LIMIT),
    truncated: text.length > TRIAGE_LIMIT, items: [],
  };
  if (cleanStoredText(text) !== text) {
    result.reason = 'The original text contains storage-unsafe characters; no traceable suggestions were generated.';
    return result;
  }
  if (!/^(en(?:[-_][a-z]{2})?|eng)$/i.test(language ?? '')) {
    result.reason = 'English only; language is unsupported or unknown.';
    return result;
  }
  let input = text.slice(0, TRIAGE_LIMIT);
  if (/[\uD800-\uDBFF]$/.test(input)) input = input.slice(0, -1);
  result.inputLength = input.length;
  const add = (kind: TextSuggestion['kind'], label: string, start: number, end: number, extra = {}) => {
    if (result.items.length >= 30 || end <= start || start < 0 || end > input.length || end - start > 120) return;
    if (result.items.some(i => i.kind === kind && i.label.toLowerCase() === label.toLowerCase())) return;
    let evidenceStart = Math.max(0, start - 60);
    let evidenceEnd = Math.min(input.length, end + 60);
    if (/[\uDC00-\uDFFF]/.test(input[evidenceStart] ?? '')) evidenceStart--;
    if (/[\uDC00-\uDFFF]/.test(input[evidenceEnd] ?? '')) evidenceEnd--;
    const evidence = input.slice(evidenceStart, evidenceEnd);
    if (cleanStoredText(label) !== label || cleanStoredText(evidence) !== evidence) return;
    result.items.push({ kind, label, start, end, evidenceStart, evidence, ...extra });
  };
  for (const brand of brands.slice(0, 20)) {
    for (const alias of brand.keywords.slice(0, 20)) {
      // Plain rain is weather as well as a brand. Only configured qualified aliases are traceable.
      if (!alias.trim() || alias.length > 120 || alias.trim().toLowerCase() === 'rain') continue;
      const escaped = alias.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').exec(input);
      if (match) add('brand', cleanStoredText(brand.name, 120), match.index, match.index + match[0].length, { alias: alias.trim().toLowerCase(), entityId: brand.id });
    }
  }
  const doc = nlp(input);
  const groups = [['person', doc.people()], ['place', doc.places()], ['organization', doc.organizations()], ['noun phrase', doc.nouns()]] as const;
  for (const [kind, group] of groups) {
    for (const candidate of group.json({ offset: true }).slice(0, 100)) {
      const terms = candidate.terms as { text: string; offset: { start: number; length: number } }[];
      if (!terms?.length || !terms[0].offset) continue;
      const start = terms[0].offset.start;
      const last = terms.at(-1)!;
      const end = last.offset.start + last.offset.length;
      const label = input.slice(start, end);
      if (result.items.some(i => start < i.end && end > i.start)) continue;
      if (kind === 'person' && !/^\p{Lu}[\p{L}'’-]+\s+\p{Lu}/u.test(label)) continue;
      if (kind !== 'noun phrase' && !/\p{Lu}/u.test(label)) continue;
      if (label.length < 3 || label.split(/\s+/).length > 8) continue;
      add(kind, label, start, end);
    }
  }
  result.status = 'suggested';
  return result;
}
