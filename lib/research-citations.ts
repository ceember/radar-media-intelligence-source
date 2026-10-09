import type { ResearchSource } from './web-research-types';

export const UNKNOWN_CITATION = 'The answer cited a source that was not read. No answer was published.';
const FORMAT_ERROR = 'The answer used an invalid citation format. No answer was published.';
const numeric = String.raw`\d+(?:\s*[-–]\s*\d+)?(?:\s*[,;]\s*\d+(?:\s*[-–]\s*\d+)?)*`;
const readIds = (sources: ResearchSource[]) => new Set(sources.filter(s => s.status === 'read' && s.text.trim()).map(s => s.id));

/** Only square brackets and explicit Source labels are citations. Parentheses/exponents remain claim text. */
export function normalizeResearchCitations(answer: string, sources: ResearchSource[]): string {
  const allowed = readIds(sources);
  function ids(cluster: string) {
    const values: number[] = [];
    for (const group of cluster.split(/[,;]/)) {
      const [start, end = start] = group.trim().split(/[-–]/).map(Number);
      if (!allowed.has(start) || !allowed.has(end)) throw Error(UNKNOWN_CITATION);
      if (end < start) throw Error(FORMAT_ERROR);
      // The retrieved set bounds expansion, including holes occupied by failed reads.
      if (end - start >= allowed.size) throw Error(UNKNOWN_CITATION);
      for (let id = start; id <= end; id++) { if (!allowed.has(id)) throw Error(UNKNOWN_CITATION); values.push(id); }
    }
    return [...new Set(values)].map(id => `[${id}]`).join('');
  }
  let result = answer;
  result = result.replace(new RegExp(String.raw`\[\s*(?:sources?\s*:?\s*)?(${numeric})\s*\]`, 'gi'), (_, cluster) => ids(cluster));
  result = result.replace(new RegExp(String.raw`\bSources?\s*:?\s+(${numeric})\b`, 'gi'), (_, cluster) => ids(cluster));
  // Detect known numeric IDs in an unfinished bracket too, before any repair can discard an unknown ID.
  for (const match of result.matchAll(new RegExp(String.raw`\[\s*(?:sources?\s*:?\s*)?(${numeric})`, 'gi'))) ids(match[1]);
  return result;
}

/** Only read sources may support the answer; every factual paragraph needs a canonical citation. */
export function checkResearchCitations(answer: string, sources: ResearchSource[]): number[] {
  const allowed = readIds(sources);
  const ids = [...answer.matchAll(/\[([1-9]\d*)\]/g)].map(m => {
    const id = Number(m[1]);
    if (!allowed.has(id)) throw Error(UNKNOWN_CITATION);
    return id;
  });
  if (/[\[\]]/.test(answer.replace(/\[[1-9]\d*\]/g, ''))) throw Error(FORMAT_ERROR);
  if (!ids.length) throw Error('The answer contained no source citations. No answer was published.');
  if (answer.trim().split(/\n\s*\n/).some(paragraph => !/\[[1-9]\d*\]/.test(paragraph)))
    throw Error('The answer contained an uncited paragraph. No answer was published.');
  return [...new Set(ids)];
}

/** A repair may move/add known citation marks, but cannot change words, measurements or punctuation. */
export function researchClaimBody(answer: string, sources: ResearchSource[]) {
  return normalizeResearchCitations(answer, sources)
    // Remove an extra bracket wrapper only when its entire contents are citation marks.
    .replace(/\[(\s*(?:\[[1-9]\d*\]\s*)+)\]/g, '$1')
    .replace(/\[[1-9]\d*\]/g, '')
    .replace(/\s+/g, ' ').trim();
}
