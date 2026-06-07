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
