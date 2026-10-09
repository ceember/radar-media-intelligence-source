import { selectedPublicUrl } from './competitor-page';

/** Server-only configuration for the two explicit gateway routes; never serialized to a client. */
export function toolsGateway(path: 'search' | 'audit-page') {
  const base = process.env.MI_TOOLS_GATEWAY_URL, token = process.env.MI_TOOLS_GATEWAY_TOKEN;
  if (!base || !token?.trim() || /[\x00-\x1f\x7f]/.test(token)) return null;
  try {
    const url = new URL(selectedPublicUrl(base));
    if (url.pathname !== '/' || url.search) return null;
    return { endpoint: new URL(`/${path}`, url).href, hostname: url.hostname, token: token.trim() };
  } catch { return null; }
}
