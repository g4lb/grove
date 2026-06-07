import { test, expect } from "bun:test";
import { installRuntime, type InstallRuntimeDeps } from "../../src/runtime/fetch-claude.ts";

function deps(over: Partial<InstallRuntimeDeps> = {}): InstallRuntimeDeps {
  return {
    platform: { os: "darwin", arch: "arm64" },
    version: "0.3.167",
    runtimeDir: "/home/.grove/runtime",
    download: async () => new Uint8Array([1, 2, 3]).buffer,
    extractClaude: async (_tgz, destDir) => `${destDir}/claude`,
    ensureExecutable: () => {},
    verifyIntegrity: async () => {},
    readMarker: () => null,
    writeMarker: () => {},
    exists: () => false,
    ...over,
  };
}

test("downloads the right tarball URL and extracts claude", async () => {
  const urls: string[] = [];
  const res = await installRuntime(deps({ download: async (u) => { urls.push(u); return new ArrayBuffer(0); } }));
  expect(urls[0]).toBe(
    "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/claude-agent-sdk-darwin-arm64-0.3.167.tgz",
  );
  expect(res.path).toBe("/home/.grove/runtime/claude");
  expect(res.skipped).toBe(false);
});

test("marks the extracted binary executable and writes the version marker", async () => {
  const calls: { chmodded: string | null; marker: string | null } = { chmodded: null, marker: null };
  await installRuntime(deps({ ensureExecutable: (p) => { calls.chmodded = p; }, writeMarker: (v) => { calls.marker = v; } }));
  expect(calls.chmodded).toBe("/home/.grove/runtime/claude");
  expect(calls.marker).toBe("0.3.167");
});

test("is idempotent: skips when the binary exists and the marker matches", async () => {
  let downloaded = false;
  const res = await installRuntime(deps({ exists: () => true, readMarker: () => "0.3.167", download: async () => { downloaded = true; return new ArrayBuffer(0); } }));
  expect(res.skipped).toBe(true);
  expect(downloaded).toBe(false);
});

test("re-fetches when the marker version differs", async () => {
  let downloaded = false;
  const res = await installRuntime(deps({ exists: () => true, readMarker: () => "0.3.100", download: async () => { downloaded = true; return new ArrayBuffer(0); } }));
  expect(downloaded).toBe(true);
  expect(res.skipped).toBe(false);
});

test("retries a failing download before succeeding", async () => {
  let attempts = 0;
  await installRuntime(deps({ download: async () => { attempts++; if (attempts < 3) throw new Error("network"); return new ArrayBuffer(0); } }));
  expect(attempts).toBe(3);
});

test("throws after exhausting retries", async () => {
  await expect(installRuntime(deps({ download: async () => { throw new Error("down"); } }))).rejects.toThrow();
});

test("uses the musl package name for musl linux", async () => {
  const urls: string[] = [];
  await installRuntime(deps({
    platform: { os: "linux", arch: "x64", libc: "musl" },
    download: async (u) => { urls.push(u); return new ArrayBuffer(0); },
  }));
  expect(urls[0]).toContain("claude-agent-sdk-linux-x64-musl");
});

test("verifies integrity before extracting; a mismatch aborts without extract/chmod/marker", async () => {
  let extracted = false;
  let chmodded = false;
  let marked = false;
  await expect(
    installRuntime(deps({
      verifyIntegrity: async () => { throw new Error("integrity mismatch"); },
      extractClaude: async (_t, d) => { extracted = true; return `${d}/claude`; },
      ensureExecutable: () => { chmodded = true; },
      writeMarker: () => { marked = true; },
    })),
  ).rejects.toThrow(/integrity/i);
  expect(extracted).toBe(false);
  expect(chmodded).toBe(false);
  expect(marked).toBe(false);
});

test("passes the downloaded bytes to verifyIntegrity before extract", async () => {
  const order: string[] = [];
  await installRuntime(deps({
    download: async () => { order.push("download"); return new ArrayBuffer(8); },
    verifyIntegrity: async () => { order.push("verify"); },
    extractClaude: async (_t, d) => { order.push("extract"); return `${d}/claude`; },
  }));
  expect(order).toEqual(["download", "verify", "extract"]);
});
