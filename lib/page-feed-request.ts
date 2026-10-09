export async function readPageFeedBody(request: Request): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 6000)) throw new Error('Request too large.');
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > 6000) {
        await reader.cancel();
        throw new Error('Request too large.');
      }
      chunks.push(result.value);
    }
    return new TextDecoder('utf-8',{ fatal:true }).decode(Buffer.concat(chunks));
  } finally { reader.releaseLock(); }
}
