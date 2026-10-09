import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-4.1-mini';

type Reservation = { id: string; status: 'RESERVED'; worst_case_micros: number };

function journal(payload: Record<string, unknown>): Record<string, unknown> {
  const root = join(process.cwd(), '..', 'data/ai-ledger/v16/openrouter');
  const script = join(process.cwd(), 'lib/openrouter_ledger.py');
  const raw = execFileSync('python3', [script], {
    input: JSON.stringify({ ...payload, root }), encoding: 'utf8', timeout: 10_000,
    maxBuffer: 16_384, env: { PATH: '/usr/bin:/bin', NODE_ENV: 'production', PYTHONDONTWRITEBYTECODE: '1' },
  });
  return JSON.parse(raw) as Record<string, unknown>;
}

export function reserveOpenRouter(args: {
  key: string; model: string; endpoint: string; purpose: string;
  system: string; user: string; maxTokens: number;
}): Reservation {
  if (process.env.RADAR_V16_OPENROUTER_APPROVED !== '1'
      || process.env.RADAR_AI_DISABLED !== '0'
      || process.env.RADAR_KEYED_MODE !== '1'
      || process.env.API_BUDGET_USD !== '5'
      || args.endpoint !== ENDPOINT || args.model !== MODEL
      || !args.key || !Number.isSafeInteger(args.maxTokens)) {
    throw new Error('OpenRouter V16 activation is held');
  }
  const body = JSON.stringify({ model: args.model, messages: [
    { role: 'system', content: args.system }, { role: 'user', content: args.user },
  ], max_completion_tokens: args.maxTokens });
  const result = journal({
    action: 'reserve', id: randomBytes(16).toString('hex'),
    now_utc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    purpose: args.purpose,
    key_sha256: createHash('sha256').update(args.key).digest('hex'),
    request_bytes: Buffer.byteLength(body), max_tokens: args.maxTokens,
    profile_sha256: process.env.RADAR_V16_PROFILE_SHA256,
    account_sha256: process.env.RADAR_V16_ACCOUNT_SHA256,
  });
  if (result.status !== 'RESERVED' || typeof result.id !== 'string'
      || typeof result.worst_case_micros !== 'number') {
    throw new Error('OpenRouter reservation was not durably approved');
  }
  return result as Reservation;
}

export function holdOpenRouter(id: string): void {
  const result = journal({ action: 'unknown', id });
  if (result.status !== 'RECONCILIATION_HOLD') {
    throw new Error('OpenRouter unknown-outcome write failed');
  }
}
