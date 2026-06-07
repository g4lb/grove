export interface DownloadProgressDeps {
  /** Injectable; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Called with (cumulativeBytesReceived, totalBytes) as the download streams. */
  onProgress?: (received: number, total: number) => void;
}

/** Download a URL into an ArrayBuffer, reporting progress when a content-length is present. */
export async function downloadWithProgress(url: string, deps: DownloadProgressDeps = {}): Promise<ArrayBuffer> {
  const f = deps.fetchFn ?? fetch;
  const res = await f(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} for ${url}`);

  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body || total === 0) return res.arrayBuffer();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      deps.onProgress?.(received, total);
    }
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out.buffer;
}
