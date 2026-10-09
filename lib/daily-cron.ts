import { mcpSelfTestEndpoint } from './mcp-origin';

// Reuse the owned-origin allowlist; never send CRON_SECRET to a request Host.
export function dailyCronEndpoint(env: Record<string, string | undefined>): string | null {
  const allowed = mcpSelfTestEndpoint(env);
  return allowed ? new URL('/api/cron/daily', allowed).href : null;
}

export function cronProjectId(url: string): number | null {
  const value = new URL(url).searchParams.get('project');
  if (value === null) return null;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error('invalid project');
  }
  return Number(value);
}

/** Start children now; the platform retains their completion after the response. */
export function startDaily(
  ids: number[], endpoint: string, secret: string,
  retain: (work: () => Promise<void>) => void, send: typeof fetch = fetch,
  timeoutMs = 270_000,
) {
  const completion = fanOutDaily(ids, endpoint, secret, send, timeoutMs);
  retain(async () => {
    const result = await completion;
    console.log('[daily cron] children completed:', JSON.stringify(result));
  });
  return { skipped: false, fanOut: true, state: 'started',
    summary: ids.map(projectId => ({ projectId, state: 'started' })) };
}

export async function cronStartupBudget<T>(work: Promise<T>, timeoutMs = 55_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Cron startup deadline exceeded')), timeoutMs);
    })]);
  } finally { clearTimeout(timer!); }
}

/** Each child gets its own 300-second invocation instead of sharing one limit. */
export async function fanOutDaily(
  ids: number[], endpoint: string, secret: string, send: typeof fetch = fetch,
  timeoutMs = 270_000,
) {
  const summary = await Promise.all(ids.map(async (projectId) => {
    const url = new URL(endpoint);
    url.searchParams.set('project', String(projectId));
    try {
      const response = await send(url, {
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(timeoutMs), redirect: 'error', cache: 'no-store',
      });
      const result = await response.json();
      return { projectId, status: response.status, ok: response.ok, result };
    } catch (error) {
      return { projectId, status: 502, ok: false, error: String((error as Error).message) };
    }
  }));
  return { skipped: false, fanOut: true, ok: summary.every(s => s.ok), summary };
}
