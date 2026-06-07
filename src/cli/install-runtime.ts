import { detectPlatform, type InstallRuntimeResult, type PlatformInfo } from "../runtime/fetch-claude.ts";

export interface InstallRuntimeCliDeps {
  platformName: string;
  archName: string;
  /** Linux C library (detected by the caller on linux); ignored on darwin. */
  libc?: "glibc" | "musl";
  version: string;
  runtimeDir: string;
  /** Injectable; defaults (in the CLI) to the real installRuntime with fetch/tar. */
  install: (platform: PlatformInfo) => Promise<InstallRuntimeResult>;
  out: (line: string) => void;
}

export async function runInstallRuntime(deps: InstallRuntimeCliDeps): Promise<number> {
  const platform = detectPlatform(deps.platformName, deps.archName, deps.libc);
  if (!platform) {
    deps.out(`unsupported platform: ${deps.platformName}/${deps.archName} (supported: darwin/linux, arm64/x64)`);
    return 1;
  }
  const label = `${platform.os}-${platform.arch}${platform.libc === "musl" ? "-musl" : ""}`;
  deps.out(`installing claude runtime ${deps.version} for ${label}…`);
  try {
    const res = await deps.install(platform);
    deps.out(res.skipped ? `claude runtime already installed at ${res.path}` : `installed claude runtime at ${res.path}`);
    return 0;
  } catch (err) {
    deps.out(`failed to install the claude runtime: ${err instanceof Error ? err.message : String(err)}`);
    deps.out("retry with: grove install-runtime");
    return 1;
  }
}
