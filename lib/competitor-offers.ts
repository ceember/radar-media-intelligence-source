import { createHash } from 'node:crypto';
import { load } from 'cheerio/slim';
import { create } from 'jsondiffpatch';
import { cleanStoredText } from './text-clean';

export type OfferField = 'price' | 'lowPrice' | 'highPrice' | 'currency' | 'billingPeriod' | 'contractLength' | 'setupFee' | 'setupCurrency' | 'vatIncluded' | 'downloadSpeed' | 'uploadSpeed';
export type OfferCandidate = { value: string | boolean; evidence: { path: string; value: string | number | boolean } };
export type StructuredOffer = {
  id: string; name: string; kind: 'Offer' | 'AggregateOffer'; stableIdentity: boolean;
  fields: Record<OfferField, string | boolean | null>;
  evidence: Partial<Record<OfferField | 'name' | 'identity', { path: string; value: string | number | boolean }>>;
  conflicts?: Partial<Record<OfferField, OfferCandidate[]>>;
};
export type StructuredOffers = { status: 'published' | 'not_published' | 'ambiguous' | 'unknown'; offers: StructuredOffer[]; warnings: string[]; method: string };
const method = 'Native bounded Schema.org JSON-LD reader v2';
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const scalar = (value: unknown, max = 120) => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value) ? cleanStoredText(String(value), max).trim() : '';
const array = (value: unknown) => Array.isArray(value) ? value : value === undefined ? [] : [value];
const timeUnit = (value: string) => /^(MON|ANN|DAY|HUR|WEE|month|year|day|hour|week)$/i.test(value);
const identifier = (value: unknown) => typeof value === 'string' && [...value].length <= 1000 ? cleanStoredText(value).trim() : '';
const money = (value: unknown) => {
  const raw = scalar(value, 64);
  if (!/^\d{1,9}(?:\.\d{1,4})?$/.test(raw)) return null;
  return raw.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};
const schemaTerm = (value: unknown, knownContext: boolean) => typeof value === 'string' && /^https?:\/\/schema\.org\/\w+$/.test(value) ? value.split('/').pop()! : knownContext && typeof value === 'string' && /^\w+$/.test(value) ? value : '';
const schemaContext = (value: unknown) => array(value).length > 0 && array(value).every(v =>
  typeof v === 'string' && /^https?:\/\/schema\.org\/?$/.test(v) || Object.keys(object(v)).length === 1 && /^https?:\/\/schema\.org\/?$/.test(String(object(v)['@vocab'])));

/** Never expands remote contexts, executes page code or infers prices from prose. */
export function readStructuredOffers(html: string, sourceUrl: string, deadline = Date.now() + 2000): StructuredOffers {
  const empty = (status: StructuredOffers['status'], warning: string): StructuredOffers => ({ status, offers: [], warnings: [warning], method });
  if (Buffer.byteLength(html) > 2_000_000) return empty('ambiguous', 'Captured HTML exceeds the parser input bound.');
  const $ = load(cleanStoredText(html)), scripts = $('script').filter((_, el) => ($(el).attr('type') ?? '').trim().toLowerCase().split(';')[0] === 'application/ld+json').toArray();
  if (!scripts.length) return empty('not_published', 'No supported JSON-LD offers in the captured static HTML.');
  const offers: StructuredOffer[] = [], warnings = new Set<string>(), seen = new Map<string, StructuredOffer>();
  let totalBytes = 0, nodes = 0;
  const warn = (message: string) => { if (warnings.size < 8) warnings.add(message); };
  try {
    if (scripts.length > 30) throw Error('Structured-data script count exceeds 30.');
    for (const [scriptIndex, element] of scripts.entries()) {
      const raw = $(element).text(); totalBytes += Buffer.byteLength(raw);
      if (totalBytes > 100_000) throw Error('Structured-data input exceeds 100 KB.');
      let root: unknown;
      try { root = JSON.parse(raw); } catch { warn('Malformed structured JSON; offer coverage is ambiguous.'); continue; }
      const refs = new Map<string, Record<string, unknown>>(), paths = new WeakMap<object, string>(), allNodes: Record<string, unknown>[] = [], bounded: { value: unknown; depth: number; path: string }[] = [{ value: root, depth: 0, path: `script[${scriptIndex}]` }];
      while (bounded.length) {
        if (Date.now() >= deadline) throw Error('Structured-data parsing reached its time budget.');
        const { value, depth, path } = bounded.pop()!;
        if (value === null || typeof value !== 'object') continue;
        if (depth > 16 || ++nodes > 2000) throw Error('Structured-data depth or node limit reached.');
        if (Array.isArray(value)) { if (value.length > 500) throw Error('Structured array exceeds 500 entries.'); value.forEach((v, i) => bounded.push({ value: v, depth: depth + 1, path: `${path}[${i}]` })); }
        else {
          const node = object(value), entries = Object.entries(node);
          allNodes.push(node);
          paths.set(node, path);
          if (node['@context'] !== undefined && !schemaContext(node['@context'])) throw Error('Unknown or custom JSON-LD context; no fields interpreted.');
          if (entries.length > 100) throw Error('Structured object exceeds 100 fields.');
          const id = identifier(node['@id']);
          if (id && entries.length > 1) { if (refs.has(id)) warn('Duplicate structured identifiers; plan identity is ambiguous.'); else refs.set(id, node); }
          for (const [key, v] of entries) if (key !== '@context') bounded.push({ value: v, depth: depth + 1, path: `${path}.${key}` });
        }
      }
      const resolve = (value: unknown) => { const node = object(value), ref = identifier(node['@id']); return Object.keys(node).length === 1 && ref && refs.has(ref) ? refs.get(ref)! : node; };
      const owners = new WeakMap<object, Record<string, unknown>>();
      for (const node of allNodes) if (array(node['@type']).some(t => schemaTerm(t, true) === 'Product'))
        for (const offer of array(node.offers)) owners.set(resolve(offer), node);
      const stack: { value: unknown; path: string; context: boolean; product: Record<string, unknown> | null; productPath: string }[] = [{ value: root, path: `script[${scriptIndex}]`, context: false, product: null, productPath: '' }];
      const processed = new WeakSet<object>();
      while (stack.length) {
        if (Date.now() >= deadline) throw Error('Structured-data parsing reached its time budget.');
        const frame = stack.pop()!;
        if (Array.isArray(frame.value)) { frame.value.forEach((v, i) => stack.push({ ...frame, value: v, path: `${frame.path}[${i}]` })); continue; }
        const node = object(frame.value); if (!Object.keys(node).length || processed.has(node)) continue;
        processed.add(node);
        frame.path = paths.get(node) ?? frame.path;
        const known = schemaContext(node['@context']) || (node['@context'] === undefined && frame.context), types = array(node['@type']).map(t => schemaTerm(t, known));
        const isProduct = types.includes('Product'), product = isProduct ? node : frame.product, productPath = isProduct ? frame.path : frame.productPath;
        const kind = types.includes('AggregateOffer') ? 'AggregateOffer' : types.includes('Offer') ? 'Offer' : null;
        if (kind) {
          const item = resolve(node.itemOffered), owner = Object.keys(item).length ? item : owners.get(node) ?? product ?? {};
          const name = scalar(node.name) || scalar(owner.name) || 'Unnamed Structured Offer';
          const identity = [[node, '@id'], [node, 'sku'], [node, 'identifier'], [owner, 'sku'], [owner, '@id']] as const;
          const identitySource = identity.find(([record, key]) => identifier(record[key])), explicitId = identitySource ? identifier(identitySource[0][identitySource[1]]) : '';
          const id = createHash('sha256').update(`${sourceUrl}\n${kind}\n${explicitId || name}`).digest('hex');
          const fields: StructuredOffer['fields'] = { price: null, lowPrice: null, highPrice: null, currency: null, billingPeriod: null, contractLength: null, setupFee: null, setupCurrency: null, vatIncluded: null, downloadSpeed: null, uploadSpeed: null };
          const evidence: StructuredOffer['evidence'] = {};
          const candidates: Partial<Record<OfferField, OfferCandidate[]>> = {};
          const conflicts: NonNullable<StructuredOffer['conflicts']> = {};
          const put = (key: OfferField, value: string | boolean | null, path: string, original: unknown) => {
            if (value === null) return;
            const values = candidates[key] ??= [];
            if (!values.some(candidate => candidate.value === value)) values.push({ value, evidence: { path: cleanStoredText(path, 200), value: typeof original === 'boolean' || typeof original === 'number' && Number.isFinite(original) ? original : scalar(original) } });
            if (values.length > 1) { conflicts[key] = values; fields[key] = null; delete evidence[key]; warn(`Conflicting ${key} values; comparison is ambiguous.`); }
            else { fields[key] = value; evidence[key] = values[0].evidence; }
          };
          if (scalar(node.name) || scalar(owner.name)) evidence.name = { path: cleanStoredText(`${scalar(node.name) ? paths.get(node) ?? frame.path : paths.get(owner) ?? frame.path}.name`, 200), value: name };
          if (explicitId && identitySource) evidence.identity = { path: cleanStoredText(`${paths.get(identitySource[0]) ?? frame.path}.${identitySource[1]}`, 200), value: cleanStoredText(explicitId, 120) };
          else warn('A plan lacks an explicit identifier; automatic changes are unknown.');
          if (node.priceType !== undefined) warn('Promotional or other price type requires human review.');
          else put('price', money(node.price), `${frame.path}.price`, node.price);
          if (kind === 'AggregateOffer') { put('lowPrice', money(node.lowPrice), `${frame.path}.lowPrice`, node.lowPrice); put('highPrice', money(node.highPrice), `${frame.path}.highPrice`, node.highPrice); }
          const currency = scalar(node.priceCurrency);
          if (/^[A-Z]{3}$/.test(currency)) put('currency', currency, `${frame.path}.priceCurrency`, node.priceCurrency);
          for (const [i, value] of array(node.priceSpecification).entries()) {
            const spec = resolve(value), specTypes = array(spec['@type']).map(t => schemaTerm(t, known)), path = paths.get(spec) ?? `${frame.path}.priceSpecification[${i}]`;
            if (!specTypes.some(t => ['PriceSpecification', 'UnitPriceSpecification'].includes(t))) { warn('Unsupported price specification; component values unknown.'); continue; }
            const component = schemaTerm(spec.priceComponentType, known);
            const setup = component === 'ActivationFee';
            if (spec.priceType !== undefined || spec.priceComponentType !== undefined && !setup && component !== 'Subscription' || spec.billingStart !== undefined && spec.billingStart !== 0) { warn('Promotional, delayed or other price component requires human review.'); continue; }
            put(setup ? 'setupFee' : 'price', money(spec.price), `${path}.price`, spec.price);
            const currency = scalar(spec.priceCurrency);
            if (/^[A-Z]{3}$/.test(currency)) put(setup ? 'setupCurrency' : 'currency', currency, `${path}.priceCurrency`, spec.priceCurrency);
            if (!setup) {
              if (typeof spec.valueAddedTaxIncluded === 'boolean') put('vatIncluded', spec.valueAddedTaxIncluded, `${path}.valueAddedTaxIncluded`, spec.valueAddedTaxIncluded);
              if (specTypes.includes('UnitPriceSpecification')) {
                const unit = scalar(spec.unitCode) || scalar(spec.unitText), quantity = object(spec.referenceQuantity);
                const referenceUnit = scalar(quantity.unitCode) || scalar(quantity.unitText), referenceValue = money(quantity.value);
                if (spec.referenceQuantity !== undefined) {
                  if (referenceValue && timeUnit(referenceUnit)) put('billingPeriod', `${referenceValue} ${referenceUnit}`, `${path}.referenceQuantity`, JSON.stringify(quantity));
                  else warn('Price reference quantity is unsupported; billing period unknown.');
                } else if (timeUnit(unit)) put('billingPeriod', `1 ${unit}`, `${path}.${spec.unitCode ? 'unitCode' : 'unitText'}`, unit);
                const duration = scalar(spec.billingDuration, 64);
                if (/^P(?=\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?$/.test(duration)) put('contractLength', duration, `${path}.billingDuration`, spec.billingDuration);
                else if (/^\d+(?:\.\d+)?$/.test(duration) && timeUnit(unit)) put('contractLength', `${duration} ${unit}`, `${path}.billingDuration + ${path}.${spec.unitCode ? 'unitCode' : 'unitText'}`, `${duration} ${unit}`);
                else {
                  const duration = object(spec.billingDuration), number = scalar(duration.value, 32), unit = scalar(duration.unitCode) || scalar(duration.unitText);
                  if (/^\d+(?:\.\d+)?$/.test(number) && timeUnit(unit)) put('contractLength', `${number} ${unit}`, `${path}.billingDuration`, JSON.stringify(duration));
                }
              }
            }
          }
          for (const [i, value] of array(owner.additionalProperty).entries()) {
            const prop = object(value), key = scalar(prop.name).toLowerCase().replace(/[^a-z]/g, '');
            if (!['downloadspeed', 'uploadspeed'].includes(key)) continue;
            const number = scalar(prop.value, 32), unit = scalar(prop.unitText) || scalar(prop.unitCode);
            if (/^\d+(?:\.\d+)?$/.test(number) && unit) put(key === 'downloadspeed' ? 'downloadSpeed' : 'uploadSpeed', `${number} ${unit}`, paths.get(prop) ?? `${productPath || frame.path}.additionalProperty[${i}]`, JSON.stringify(prop));
          }
          const offer: StructuredOffer = { id, name, kind, stableIdentity: !!explicitId, fields, evidence, conflicts };
          const previous = seen.get(id);
          if (previous) {
            if (JSON.stringify(previous.fields) !== JSON.stringify(fields)) warn('Duplicate plan identifier has conflicting offer values.');
            for (const key of Object.keys(fields) as OfferField[]) {
              const values = previous.conflicts?.[key] ?? (previous.fields[key] !== null && previous.evidence[key] ? [{ value: previous.fields[key]!, evidence: previous.evidence[key]! }] : []);
              for (const candidate of candidates[key] ?? []) if (!values.some(v => v.value === candidate.value)) values.push(candidate);
              if (values.length > 1) {
                (previous.conflicts ??= {})[key] = values; previous.fields[key] = null; delete previous.evidence[key];
                warn(`Conflicting ${key} values; comparison is ambiguous.`);
              } else if (values.length === 1) { previous.fields[key] = values[0].value; previous.evidence[key] = values[0].evidence; }
            }
          }
          else if (offers.length < 20) { seen.set(id, offer); offers.push(offer); }
          else warn('More than 20 offers published; only the first 20 candidates are shown.');
        }
        for (const [key, value] of Object.entries(node)) if (key !== '@context' && value !== null && typeof value === 'object') stack.push({ value: key === 'offers' ? Array.isArray(value) ? value.map(resolve) : resolve(value) : value, path: `${frame.path}.${key}`, context: known, product, productPath });
      }
    }
  } catch (error) { return empty('ambiguous', error instanceof Error ? error.message : 'Structured-data parsing failed.'); }
  return { status: warnings.size ? 'ambiguous' : offers.length ? 'published' : 'not_published', offers, warnings: [...warnings], method };
}

/** Pure bounded JSON deltas; upstream HTML/text formatters are never used. */
export function compareStructuredOffers(previous: StructuredOffers | null | undefined, current: StructuredOffers | null | undefined) {
  const uncertain = (o: StructuredOffer) => !o.stableIdentity || Object.values(o.conflicts ?? {}).some(values => values.length > 1);
  if (current?.status !== 'published' || current.offers.some(uncertain) || previous && (previous.status !== 'published' || previous.offers.some(uncertain))) return { status: 'unknown' as const, changes: [] };
  if (!previous) return { status: 'baseline' as const, changes: [] };
  const records = (value: StructuredOffers) => Object.fromEntries(value.offers.map(o => [o.id, o.fields]));
  const before = records(previous), after = records(current), delta = create().diff(before, after);
  const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap<{ id: string; name: string; field: string; before: string | boolean; after: string | boolean }>(id => {
    const old = before[id], next = after[id], name = current.offers.find(o => o.id === id)?.name ?? previous.offers.find(o => o.id === id)!.name;
    if (!old || !next) return [{ id, name, field: 'Published Structured Entry', before: old ? 'Present' : 'Not present in markup', after: next ? 'Present' : 'Not present in markup' }];
    return Object.keys(next).filter(key => old[key as OfferField] !== next[key as OfferField]).map(key => ({ id, name, field: key, before: old[key as OfferField] ?? 'Unknown', after: next[key as OfferField] ?? 'Unknown' }));
  });
  return { status: delta ? 'changed' as const : 'unchanged' as const, changes };
}
