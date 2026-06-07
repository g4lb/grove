import { existsSync } from "node:fs";

export interface PlatformInfo {
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
  /** Present only for musl-based Linux; absent ⇒ glibc / not applicable. */
  libc?: "musl";
}

/** Map Node/Bun `process.platform`/`process.arch` to a supported PlatformInfo, or null. */
export function detectPlatform(platform: string, arch: string, libc?: "glibc" | "musl"): PlatformInfo | null {
  const os = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : null;
  const a = arch === "arm64" ? "arm64" : arch === "x64" || arch === "x86_64" ? "x64" : null;
  if (!os || !a) return null;
  const info: PlatformInfo = { os, arch: a };
  if (os === "linux" && libc === "musl") info.libc = "musl";
  return info;
}

export function platformPackage(p: PlatformInfo): string {
  const suffix = p.libc === "musl" ? "-musl" : "";
  return `@anthropic-ai/claude-agent-sdk-${p.os}-${p.arch}${suffix}`;
}

/** Detect the Linux C library by probing for the musl dynamic loader. Probe injectable for tests. */
export function detectLibc(probe: (path: string) => boolean = existsSync): "glibc" | "musl" {
  const muslLoaders = ["/lib/ld-musl-x86_64.so.1", "/lib/ld-musl-aarch64.so.1"];
  return muslLoaders.some((p) => probe(p)) ? "musl" : "glibc";
}

/** npm registry tarball URL: https://registry.npmjs.org/<pkg>/-/<unscoped>-<version>.tgz */
export function tarballUrl(pkg: string, version: string): string {
  const unscoped = pkg.split("/").pop()!;
  return `https://registry.npmjs.org/${pkg}/-/${unscoped}-${version}.tgz`;
}

import { join } from "node:path";

export interface InstallRuntimeDeps {
  platform: PlatformInfo;
  version: string;
  runtimeDir: string;
  download: (url: string) => Promise<ArrayBuffer>;
  extractClaude: (tgz: ArrayBuffer, destDir: string) => Promise<string>;
  ensureExecutable: (path: string) => void;
  readMarker: () => string | null;
  writeMarker: (version: string) => void;
  exists: () => boolean;
  retries?: number;
}

export interface InstallRuntimeResult {
  path: string;
  skipped: boolean;
}

async function withRetry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Fetch + extract the pinned native claude binary into <runtimeDir>/claude. Idempotent. */
export async function installRuntime(deps: InstallRuntimeDeps): Promise<InstallRuntimeResult> {
  const dest = join(deps.runtimeDir, "claude");
  if (deps.exists() && deps.readMarker() === deps.version) {
    return { path: dest, skipped: true };
  }
  const url = tarballUrl(platformPackage(deps.platform), deps.version);
  const tgz = await withRetry(() => deps.download(url), deps.retries ?? 3);
  const path = await deps.extractClaude(tgz, deps.runtimeDir);
  deps.ensureExecutable(path);
  deps.writeMarker(deps.version);
  return { path, skipped: false };
}
