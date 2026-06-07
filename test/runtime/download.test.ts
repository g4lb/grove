import { test, expect } from "bun:test";
import { downloadWithProgress } from "../../src/runtime/download.ts";

// Build a fake fetch returning a streamed body with a content-length.
function fakeFetch(chunks: Uint8Array[], ok = true): typeof fetch {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  return (async () => {
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(chunks[i++]!);
        else controller.close();
      },
    });
    return new Response(ok ? stream : null, {
      status: ok ? 200 : 500,
      headers: ok ? { "content-length": String(total) } : {},
    });
  }) as unknown as typeof fetch;
}

test("returns the concatenated bytes and reports cumulative progress", async () => {
  const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])];
  const seen: Array<[number, number]> = [];
  const buf = await downloadWithProgress("http://x/y", {
    fetchFn: fakeFetch(chunks),
    onProgress: (received, total) => seen.push([received, total]),
  });
  expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  expect(seen).toEqual([[3, 6], [5, 6], [6, 6]]); // cumulative received, constant total
});

test("throws on a non-ok response", async () => {
  await expect(downloadWithProgress("http://x/y", { fetchFn: fakeFetch([], false) })).rejects.toThrow();
});

test("falls back to arrayBuffer when there is no content-length", async () => {
  const f = (async () => new Response(new Uint8Array([9, 9]), { status: 200 })) as unknown as typeof fetch;
  const buf = await downloadWithProgress("http://x/y", { fetchFn: f });
  expect(new Uint8Array(buf)).toEqual(new Uint8Array([9, 9]));
});
