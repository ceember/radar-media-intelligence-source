/** Never infer a token-bearing self-test destination from request headers. */
export function mcpSelfTestEndpoint(env: Record<string, string | undefined>): string | null {
  const raw = env.APP_URL || (env.VERCEL === '1' && env.VERCEL_URL
    ? `https://${env.VERCEL_URL}` : undefined);
  if (!raw) return null;
  try {
    const owned = new URL(raw);
    if (owned.username || owned.password || owned.pathname !== '/' || owned.search || owned.hash ||
        raw !== owned.origin && raw !== `${owned.origin}/`) return null;
    const hosted = env.VERCEL === '1' && owned.protocol === 'https:' && !owned.port &&
      [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL].includes(owned.hostname);
    const local = owned.protocol === 'http:' && owned.hostname === '127.0.0.1' &&
      Boolean(env.PORT && /^[1-9]\d{0,4}$/.test(env.PORT) && Number(env.PORT) <= 65535 && owned.port === env.PORT);
    return hosted || local ? `${owned.origin}/api/mcp` : null;
  } catch {
    return null;
  }
}
