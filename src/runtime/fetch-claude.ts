export interface PlatformInfo {
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
}

/** Map Node/Bun `process.platform`/`process.arch` to a supported PlatformInfo, or null. */
export function detectPlatform(platform: string, arch: string): PlatformInfo | null {
  const os = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : null;
  const a = arch === "arm64" ? "arm64" : arch === "x64" || arch === "x86_64" ? "x64" : null;
  if (!os || !a) return null;
  return { os, arch: a };
}

export function platformPackage(p: PlatformInfo): string {
  return `@anthropic-ai/claude-agent-sdk-${p.os}-${p.arch}`;
}

/** npm registry tarball URL: https://registry.npmjs.org/<pkg>/-/<unscoped>-<version>.tgz */
export function tarballUrl(pkg: string, version: string): string {
  const unscoped = pkg.split("/").pop()!;
  return `https://registry.npmjs.org/${pkg}/-/${unscoped}-${version}.tgz`;
}
