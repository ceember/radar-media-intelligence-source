/** PostgreSQL TEXT/JSONB cannot store NUL or lone UTF-16 surrogates. */
export function cleanStoredText(value: string, maxCodePoints?: number): string {
  const clean = value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD').replaceAll('\u0000', '');
  return maxCodePoints === undefined ? clean : Array.from(clean).slice(0, maxCodePoints).join('');
}
