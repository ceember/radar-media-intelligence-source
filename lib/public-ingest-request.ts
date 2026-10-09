export function configuredPublicIngestOrigin(app: unknown, configured: unknown): boolean {
  if (typeof app !== 'string' || typeof configured !== 'string' || !configured || app !== configured) return false;
  try {
    const origin = new URL(configured);
    return origin.origin === configured && origin.protocol === 'http:' && origin.hostname === '127.0.0.1'
      && !!origin.port && !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash;
  } catch { return false; }
}

/** Content-Length: 0 may still arrive as a non-null, already-ended Request.body. */
export async function emptyPostBody(req: Request): Promise<boolean> {
  if (req.headers.get('content-length') !== '0' || req.headers.has('transfer-encoding')) return false;
  if (!req.body) return true;
  const reader = req.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('body timeout')), 1_000); }),
    ]);
    return result.done === true && (!result.value || result.value.byteLength === 0);
  } catch { return false; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); }
}
