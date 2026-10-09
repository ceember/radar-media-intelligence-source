// Cache in memoria delle credenziali dei connettori (nome-variabile -> valore).
// Viene idratata lato server prima di usare i connettori (vedi
// hydrateConnectorCredentials in connector-credentials.ts) e letta in modo
// SINCRONO dentro enabled()/fetchMentions().
//
// Questo file NON importa nulla di server-only (niente DB, niente node:crypto):
// così i connettori restano importabili anche dai componenti client che usano
// SOURCE_META, senza trascinare il database nel bundle del browser.

let cache: Record<string, string> = {};

export function setConnectorConfig(store: Record<string, string>) {
  cache = store;
}

/**
 * Valore di una credenziale: prima quella inserita dall'utente (salvata nel
 * DB e idratata in cache), poi la variabile d'ambiente come fallback (le chiavi
 * "embeddate" lato server continuano quindi a funzionare). Stringa vuota = assente.
 */
export function cfg(env: string): string | undefined {
  // Provider credentials stay unavailable even after saved-key UI tests.
  // MCP is instance authentication, not a paid/public-data provider credential.
  if (process.env.RADAR_CREDENTIAL_FREE === '1' && env !== 'RADAR_MCP_TOKEN') return undefined;
  // The reviewed private source keys come only from protected private.env.
  if (process.env.RADAR_SOURCE_ALLOWLIST !== undefined
      && (env === 'NEWSDATA_API_KEY' || env === 'TAVILY_API_KEY'
          || env === 'ALPHA_VANTAGE_API_KEY' || env === 'FOOTBALL_DATA_API_KEY'
          || env === 'YOUTUBE_API_KEY')) {
    const value = process.env[env];
    return value && value.trim() ? value : undefined;
  }
  const fromCache = cache[env];
  if (fromCache && fromCache.trim()) return fromCache;
  const fromEnv = typeof process !== 'undefined' ? process.env[env] : undefined;
  return fromEnv && fromEnv.trim() ? fromEnv : undefined;
}

/** Runtime eligibility only: preserve the complete Settings/MCP catalogue. */
export function sourceAllowed(id: string, tier: 'free' | 'freekey' | 'premium'): boolean {
  const credentialFree = process.env.RADAR_CREDENTIAL_FREE === '1';
  if (credentialFree && tier !== 'free') return false;
  const raw = process.env.RADAR_SOURCE_ALLOWLIST;
  if (raw === undefined) return !credentialFree; // legacy unchanged; private mode fails closed
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(id);
}
