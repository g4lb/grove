# grove — Packaging-1: Runtime Code — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The in-repo runtime code that lets a compiled grove find and fetch the version-pinned native `claude` binary: a path resolver, a baked SDK-version pin, a fetcher + `grove install-runtime` command, a `doctor` check, and the `SdkAgentRunner`/run/TUI wiring. (Distribution — build matrix, `install.sh`, brew tap, release workflow — is Packaging-2.)

**Architecture:** All IO behind injected interfaces (same discipline as the rest of grove). `resolveClaudePath` picks the `claude` binary by precedence (`$GROVE_CLAUDE_PATH → <root>/runtime/claude → PATH → null`). `installRuntime` downloads the npm tarball for `@anthropic-ai/claude-agent-sdk-<platform>@<CLAUDE_SDK_VERSION>` and extracts `claude`. `SdkAgentRunner` passes the resolved path as the SDK's `pathToClaudeCodeExecutable` only when present (dev with `node_modules` is unchanged).

**Tech Stack:** Bun, TypeScript (strict). Spec: `docs/superpowers/specs/2026-06-07-grove-release-packaging-design.md`.

---

## Context for the implementer (read once)

- `src/agent/sdk-agent-runner.ts` — `SdkAgentRunner({ queryFn?, env? })`; in `run()` it calls `this.queryFn({ prompt, options: {...} })`. The SDK `options` accept `pathToClaudeCodeExecutable?: string`.
- `src/config/paths.ts` — `resolvePaths(root?)` → `GrovePaths { root, dbFile, tasksDir, ... }`. (This plan does NOT modify it; callers compute `join(paths.root, "runtime")`.)
- `src/cli/index.ts` — `main(argv)` switch dispatches `undefined`(TUI)/`--version`/`doctor`/`init`/`gc`/`run`; `grovePaths()` helper; builds the engine in the `run` case and `launchTui`.
- `src/cli/doctor.ts` — `runDoctor(runner): Promise<{ ok: boolean; checks: Array<{ name; ok; detail }> }>`.
- `src/cli/run-driver.ts` — `runTask(prose, deps: RunDeps)`; `RunDeps` has `hasCredential: boolean` (a precheck that fails fast). The `run` case + `launchTui` build a real `SdkAgentRunner`.
- `src/agent/credentials.ts` — `detectCredentials(env)` (pattern to mirror for the runtime precheck).
- `Bun.which(cmd): string | null` resolves a command on PATH (sync). `Bun.spawn`/`fetch` for IO.
- Imports use explicit `.ts` extensions. TDD throughout. One logical change per commit.

**Environment quirk:** bun is at `~/.bun/bin/bun`, NOT on PATH. Prepend `export PATH="$HOME/.bun/bin:$PATH";` to every bun command. Verify `bun --version` → `1.3.14`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/agent/claude-binary.ts` | `resolveClaudePath(deps)` — pick the claude binary by precedence |
| `src/agent/sdk-version.ts` | generated `CLAUDE_SDK_VERSION` constant |
| `scripts/write-sdk-version.ts` | regenerates `sdk-version.ts` from the installed SDK |
| `src/runtime/fetch-claude.ts` | platform mapping + `installRuntime(deps)` fetcher |
| `src/cli/install-runtime.ts` | `runInstallRuntime(deps)` orchestrator (real download/extract) |
| `src/cli/index.ts` | (modify) dispatch `install-runtime`; runtime precheck + pass claude path in `run`/`launchTui` |
| `src/cli/doctor.ts` | (modify) add the claude-runtime check |
| `src/agent/sdk-agent-runner.ts` | (modify) pass `pathToClaudeCodeExecutable` when set |
| `src/cli/run-driver.ts` | (modify) `hasClaudeRuntime` precheck |
| `package.json` | (modify) build runs `write-sdk-version` first |

---

## Task 1: `resolveClaudePath`

**Files:** Create `src/agent/claude-binary.ts`, Test `test/agent/claude-binary.test.ts`.

- [ ] **Step 1: Write the failing test**

`test/agent/claude-binary.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { resolveClaudePath } from "../../src/agent/claude-binary.ts";

function deps(over: Partial<Parameters<typeof resolveClaudePath>[0]> = {}) {
  return {
    env: {} as Record<string, string | undefined>,
    runtimeDir: "/home/.grove/runtime",
    isExecutable: () => false,
    whichClaude: () => null,
    ...over,
  };
}

test("prefers $GROVE_CLAUDE_PATH when it is executable", () => {
  const p = resolveClaudePath(deps({ env: { GROVE_CLAUDE_PATH: "/custom/claude" }, isExecutable: (x) => x === "/custom/claude" }));
  expect(p).toBe("/custom/claude");
});

test("falls back to the runtime dir when no env override", () => {
  const p = resolveClaudePath(deps({ isExecutable: (x) => x === "/home/.grove/runtime/claude" }));
  expect(p).toBe("/home/.grove/runtime/claude");
});

test("falls back to PATH (whichClaude) when neither env nor runtime dir", () => {
  const p = resolveClaudePath(deps({ whichClaude: () => "/usr/local/bin/claude", isExecutable: (x) => x === "/usr/local/bin/claude" }));
  expect(p).toBe("/usr/local/bin/claude");
});

test("returns null when nothing resolves", () => {
  expect(resolveClaudePath(deps())).toBe(null);
});

test("precedence: env over runtime over PATH", () => {
  const p = resolveClaudePath(deps({
    env: { GROVE_CLAUDE_PATH: "/a/claude" },
    whichClaude: () => "/c/claude",
    isExecutable: () => true, // all exist → env wins
  }));
  expect(p).toBe("/a/claude");
});

test("ignores a non-executable env override and continues down the chain", () => {
  const p = resolveClaudePath(deps({
    env: { GROVE_CLAUDE_PATH: "/missing/claude" },
    isExecutable: (x) => x === "/home/.grove/runtime/claude",
  }));
  expect(p).toBe("/home/.grove/runtime/claude");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/claude-binary.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

`src/agent/claude-binary.ts`:
```typescript
import { accessSync, constants } from "node:fs";
import { join } from "node:path";

export interface ResolveClaudeDeps {
  env: Record<string, string | undefined>;
  /** `<grove root>/runtime` — where `grove install-runtime` places the binary. */
  runtimeDir: string;
  /** Injectable for tests; defaults to an fs X_OK check. */
  isExecutable?: (path: string) => boolean;
  /** Injectable for tests; defaults to `Bun.which("claude")`. */
  whichClaude?: () => string | null;
}

function defaultIsExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultWhichClaude(): string | null {
  return Bun.which("claude");
}

/**
 * Resolve the native `claude` binary grove drives, by precedence:
 *   $GROVE_CLAUDE_PATH → <runtimeDir>/claude → `claude` on PATH → null.
 * `null` means "let the SDK self-resolve from node_modules" (dev).
 */
export function resolveClaudePath(deps: ResolveClaudeDeps): string | null {
  const isExec = deps.isExecutable ?? defaultIsExecutable;
  const override = deps.env.GROVE_CLAUDE_PATH;
  if (override && isExec(override)) return override;

  const runtime = join(deps.runtimeDir, "claude");
  if (isExec(runtime)) return runtime;

  const onPath = (deps.whichClaude ?? defaultWhichClaude)();
  if (onPath && isExec(onPath)) return onPath;

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/claude-binary.test.ts`
Expected: PASS — 6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent/claude-binary.ts test/agent/claude-binary.test.ts
git commit -m "feat: add resolveClaudePath (locate the native claude binary)"
```

---

## Task 2: Pinned `CLAUDE_SDK_VERSION`

**Files:** Create `scripts/write-sdk-version.ts`, generate `src/agent/sdk-version.ts`, Test `test/agent/sdk-version.test.ts`, modify `package.json`.

- [ ] **Step 1: Write the failing test**

`test/agent/sdk-version.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { CLAUDE_SDK_VERSION } from "../../src/agent/sdk-version.ts";

test("CLAUDE_SDK_VERSION is a non-empty semver", () => {
  expect(CLAUDE_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
});

test("CLAUDE_SDK_VERSION matches the installed Agent SDK (guards drift)", () => {
  const installed = JSON.parse(
    readFileSync("node_modules/@anthropic-ai/claude-agent-sdk/package.json", "utf8"),
  ).version as string;
  expect(CLAUDE_SDK_VERSION).toBe(installed);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/sdk-version.test.ts`
Expected: FAIL — `src/agent/sdk-version.ts` missing.

- [ ] **Step 3: Write the generator and generate the file**

`scripts/write-sdk-version.ts`:
```typescript
import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(
  readFileSync("node_modules/@anthropic-ai/claude-agent-sdk/package.json", "utf8"),
).version as string;

writeFileSync(
  "src/agent/sdk-version.ts",
  `// AUTO-GENERATED by scripts/write-sdk-version.ts — do not edit by hand.\n` +
    `// The exact @anthropic-ai/claude-agent-sdk version grove was built against;\n` +
    `// the fetcher pulls this exact native claude binary for protocol compatibility.\n` +
    `export const CLAUDE_SDK_VERSION = ${JSON.stringify(version)};\n`,
);

console.log(`wrote CLAUDE_SDK_VERSION=${version}`);
```

Generate the committed file: `export PATH="$HOME/.bun/bin:$PATH"; bun scripts/write-sdk-version.ts` — this creates `src/agent/sdk-version.ts`. Verify it contains `export const CLAUDE_SDK_VERSION = "...";`.

- [ ] **Step 4: Wire the build to regenerate it**

In `package.json`, change the `build` script so it regenerates the pin first:
```json
    "build": "bun scripts/write-sdk-version.ts && bun build ./src/cli/index.ts --compile --outfile dist/grove"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/sdk-version.test.ts`
Expected: PASS — 2 pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/write-sdk-version.ts src/agent/sdk-version.ts test/agent/sdk-version.test.ts package.json
git commit -m "feat: bake the pinned CLAUDE_SDK_VERSION for the runtime fetcher"
```

---

## Task 3: Platform mapping helpers

**Files:** Create `src/runtime/fetch-claude.ts` (helpers only this task), Test `test/runtime/platform.test.ts`.

- [ ] **Step 1: Write the failing test**

`test/runtime/platform.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { detectPlatform, platformPackage, tarballUrl } from "../../src/runtime/fetch-claude.ts";

test("detectPlatform maps supported os/arch", () => {
  expect(detectPlatform("darwin", "arm64")).toEqual({ os: "darwin", arch: "arm64" });
  expect(detectPlatform("darwin", "x64")).toEqual({ os: "darwin", arch: "x64" });
  expect(detectPlatform("linux", "x64")).toEqual({ os: "linux", arch: "x64" });
  expect(detectPlatform("linux", "arm64")).toEqual({ os: "linux", arch: "arm64" });
  expect(detectPlatform("linux", "x86_64")).toEqual({ os: "linux", arch: "x64" });
});

test("detectPlatform returns null for unsupported platforms", () => {
  expect(detectPlatform("win32", "x64")).toBe(null);
  expect(detectPlatform("linux", "ppc64")).toBe(null);
});

test("platformPackage builds the scoped package name", () => {
  expect(platformPackage({ os: "darwin", arch: "arm64" })).toBe("@anthropic-ai/claude-agent-sdk-darwin-arm64");
  expect(platformPackage({ os: "linux", arch: "x64" })).toBe("@anthropic-ai/claude-agent-sdk-linux-x64");
});

test("tarballUrl builds the npm registry tarball URL", () => {
  expect(tarballUrl("@anthropic-ai/claude-agent-sdk-darwin-arm64", "0.3.167")).toBe(
    "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/claude-agent-sdk-darwin-arm64-0.3.167.tgz",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/runtime/platform.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

`src/runtime/fetch-claude.ts`:
```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/runtime/platform.test.ts`
Expected: PASS — 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/fetch-claude.ts test/runtime/platform.test.ts
git commit -m "feat: add claude platform mapping + tarball URL helpers"
```

---

## Task 4: `installRuntime` fetcher

**Files:** Modify `src/runtime/fetch-claude.ts` (add the fetcher), Test `test/runtime/install-runtime.test.ts`.

- [ ] **Step 1: Write the failing test**

`test/runtime/install-runtime.test.ts`:
```typescript
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
  let chmodded: string | null = null;
  let marker: string | null = null;
  await installRuntime(deps({
    ensureExecutable: (p) => { chmodded = p; },
    writeMarker: (v) => { marker = v; },
  }));
  expect(chmodded).toBe("/home/.grove/runtime/claude");
  expect(marker).toBe("0.3.167");
});

test("is idempotent: skips when the binary exists and the marker matches", async () => {
  let downloaded = false;
  const res = await installRuntime(deps({
    exists: () => true,
    readMarker: () => "0.3.167",
    download: async () => { downloaded = true; return new ArrayBuffer(0); },
  }));
  expect(res.skipped).toBe(true);
  expect(downloaded).toBe(false);
});

test("re-fetches when the marker version differs", async () => {
  let downloaded = false;
  const res = await installRuntime(deps({
    exists: () => true,
    readMarker: () => "0.3.100",
    download: async () => { downloaded = true; return new ArrayBuffer(0); },
  }));
  expect(downloaded).toBe(true);
  expect(res.skipped).toBe(false);
});

test("retries a failing download before succeeding", async () => {
  let attempts = 0;
  await installRuntime(deps({
    download: async () => {
      attempts++;
      if (attempts < 3) throw new Error("network");
      return new ArrayBuffer(0);
    },
  }));
  expect(attempts).toBe(3);
});

test("throws after exhausting retries", async () => {
  await expect(
    installRuntime(deps({ download: async () => { throw new Error("down"); } })),
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/runtime/install-runtime.test.ts`
Expected: FAIL — `installRuntime` not exported.

- [ ] **Step 3: Add `installRuntime` to `src/runtime/fetch-claude.ts`**

Append:
```typescript
import { join } from "node:path";

export interface InstallRuntimeDeps {
  platform: PlatformInfo;
  version: string;
  runtimeDir: string;
  /** Download the tarball bytes for a URL. Injectable. */
  download: (url: string) => Promise<ArrayBuffer>;
  /** Extract `package/claude` from the tarball into destDir; return the binary path. Injectable. */
  extractClaude: (tgz: ArrayBuffer, destDir: string) => Promise<string>;
  ensureExecutable: (path: string) => void;
  /** Read the installed version marker (or null). */
  readMarker: () => string | null;
  writeMarker: (version: string) => void;
  /** Whether the claude binary already exists at <runtimeDir>/claude. */
  exists: () => boolean;
  /** Max download attempts (default 3). */
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/runtime/install-runtime.test.ts`
Expected: PASS — 6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/fetch-claude.ts test/runtime/install-runtime.test.ts
git commit -m "feat: add installRuntime fetcher (retry + idempotent version marker)"
```

---

## Task 5: `grove install-runtime` command

**Files:** Create `src/cli/install-runtime.ts`, Test `test/cli/install-runtime.test.ts`, modify `src/cli/index.ts`.

`runInstallRuntime` is the orchestrator with real IO injected; the CLI wires the real download (`fetch`) and extract (`tar`). Tested with fakes (no network).

- [ ] **Step 1: Write the failing test**

`test/cli/install-runtime.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { runInstallRuntime, type InstallRuntimeCliDeps } from "../../src/cli/install-runtime.ts";

function deps(over: Partial<InstallRuntimeCliDeps> = {}): InstallRuntimeCliDeps {
  return {
    platformName: "darwin",
    archName: "arm64",
    version: "0.3.167",
    runtimeDir: "/home/.grove/runtime",
    install: async () => ({ path: "/home/.grove/runtime/claude", skipped: false }),
    out: () => {},
    ...over,
  };
}

test("returns 0 and reports success on a supported platform", async () => {
  const lines: string[] = [];
  const code = await runInstallRuntime(deps({ out: (l) => lines.push(l) }));
  expect(code).toBe(0);
  expect(lines.join("\n").toLowerCase()).toContain("claude");
});

test("returns 0 and notes a skip when already installed", async () => {
  const lines: string[] = [];
  const code = await runInstallRuntime(deps({
    install: async () => ({ path: "/home/.grove/runtime/claude", skipped: true }),
    out: (l) => lines.push(l),
  }));
  expect(code).toBe(0);
  expect(lines.join("\n").toLowerCase()).toContain("already");
});

test("returns 1 with a clear message on an unsupported platform (never calls install)", async () => {
  let installed = false;
  const lines: string[] = [];
  const code = await runInstallRuntime(deps({
    platformName: "win32",
    install: async () => { installed = true; return { path: "x", skipped: false }; },
    out: (l) => lines.push(l),
  }));
  expect(code).toBe(1);
  expect(installed).toBe(false);
  expect(lines.join("\n").toLowerCase()).toContain("unsupported");
});

test("returns 1 and surfaces a fetch failure", async () => {
  const lines: string[] = [];
  const code = await runInstallRuntime(deps({
    install: async () => { throw new Error("network down"); },
    out: (l) => lines.push(l),
  }));
  expect(code).toBe(1);
  expect(lines.join("\n").toLowerCase()).toContain("failed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/install-runtime.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/cli/install-runtime.ts`**

```typescript
import { detectPlatform, installRuntime, type InstallRuntimeResult } from "../runtime/fetch-claude.ts";

export interface InstallRuntimeCliDeps {
  platformName: string;
  archName: string;
  version: string;
  runtimeDir: string;
  /** Injectable; defaults to the real installRuntime with fetch/tar. */
  install: (p: { os: "darwin" | "linux"; arch: "arm64" | "x64" }) => Promise<InstallRuntimeResult>;
  out: (line: string) => void;
}

export async function runInstallRuntime(deps: InstallRuntimeCliDeps): Promise<number> {
  const platform = detectPlatform(deps.platformName, deps.archName);
  if (!platform) {
    deps.out(`unsupported platform: ${deps.platformName}/${deps.archName} (supported: darwin/linux, arm64/x64)`);
    return 1;
  }
  deps.out(`installing claude runtime ${deps.version} for ${platform.os}-${platform.arch}…`);
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
```

- [ ] **Step 4: Wire the real command into `src/cli/index.ts`**

Add imports:
```typescript
import { join } from "node:path"; // (already imported)
import { chmodSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { CLAUDE_SDK_VERSION } from "../agent/sdk-version.ts";
import { installRuntime } from "../runtime/fetch-claude.ts";
import { runInstallRuntime } from "./install-runtime.ts";
```
Add a `case "install-runtime":` to the switch:
```typescript
    case "install-runtime": {
      const paths = grovePaths();
      const runtimeDir = join(paths.root, "runtime");
      mkdirSync(runtimeDir, { recursive: true });
      const markerPath = join(runtimeDir, "claude.version");
      return runInstallRuntime({
        platformName: process.platform,
        archName: process.arch,
        version: CLAUDE_SDK_VERSION,
        runtimeDir,
        out: (line) => console.log(line),
        install: (platform) =>
          installRuntime({
            platform,
            version: CLAUDE_SDK_VERSION,
            runtimeDir,
            download: async (url) => {
              const res = await fetch(url);
              if (!res.ok) throw new Error(`registry returned ${res.status} for ${url}`);
              return res.arrayBuffer();
            },
            extractClaude: async (tgz, destDir) => {
              const tmp = join(destDir, "claude.tgz");
              writeFileSync(tmp, new Uint8Array(tgz));
              const proc = Bun.spawn(["tar", "-xzf", tmp, "-C", destDir, "--strip-components=1", "package/claude"], {
                stdout: "pipe",
                stderr: "pipe",
              });
              if ((await proc.exited) !== 0) throw new Error("failed to extract claude from the tarball");
              return join(destDir, "claude");
            },
            ensureExecutable: (p) => chmodSync(p, 0o755),
            readMarker: () => (existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() : null),
            writeMarker: (v) => writeFileSync(markerPath, v),
            exists: () => existsSync(join(runtimeDir, "claude")),
          }),
      });
    }
```
Update `printUsage` to include `install-runtime`.

- [ ] **Step 5: Run tests + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/install-runtime.test.ts && bun test && bun run typecheck`
Expected: target 4 pass; full suite all pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/cli/install-runtime.ts test/cli/install-runtime.test.ts src/cli/index.ts
git commit -m "feat: add grove install-runtime command"
```

---

## Task 6: `doctor` claude-runtime check

**Files:** Modify `src/cli/doctor.ts`, Test `test/cli/doctor-runtime.test.ts`.

- [ ] **Step 1: Write the failing test**

`test/cli/doctor-runtime.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { checkClaudeRuntime } from "../../src/cli/doctor.ts";

test("ok when the binary resolves and the version matches", async () => {
  const c = await checkClaudeRuntime({
    resolve: () => "/home/.grove/runtime/claude",
    claudeVersion: async () => "0.3.167",
    expected: "0.3.167",
  });
  expect(c.ok).toBe(true);
  expect(c.detail).toContain("0.3.167");
});

test("fails with an install hint when the binary is missing", async () => {
  const c = await checkClaudeRuntime({
    resolve: () => null,
    claudeVersion: async () => null,
    expected: "0.3.167",
  });
  expect(c.ok).toBe(false);
  expect(c.detail.toLowerCase()).toContain("install-runtime");
});

test("warns (still ok) on a version mismatch", async () => {
  const c = await checkClaudeRuntime({
    resolve: () => "/home/.grove/runtime/claude",
    claudeVersion: async () => "0.3.100",
    expected: "0.3.167",
  });
  expect(c.ok).toBe(true);
  expect(c.detail.toLowerCase()).toContain("mismatch");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/doctor-runtime.test.ts`
Expected: FAIL — `checkClaudeRuntime` not exported.

- [ ] **Step 3: Add `checkClaudeRuntime` to `src/cli/doctor.ts`**

```typescript
export interface ClaudeRuntimeCheckDeps {
  resolve: () => string | null;
  claudeVersion: (path: string) => Promise<string | null>;
  expected: string;
}

export async function checkClaudeRuntime(
  deps: ClaudeRuntimeCheckDeps,
): Promise<{ name: string; ok: boolean; detail: string }> {
  const name = "claude runtime";
  const path = deps.resolve();
  if (!path) {
    return { name, ok: false, detail: "not installed — run `grove install-runtime`" };
  }
  const version = await deps.claudeVersion(path);
  if (version && version !== deps.expected) {
    return { name, ok: true, detail: `version mismatch: ${version} (expected ${deps.expected}) — run \`grove install-runtime\`` };
  }
  return { name, ok: true, detail: `${path} (${version ?? "version unknown"})` };
}
```
Wire it into `runDoctor`: after the existing checks, resolve the claude path (using `resolveClaudePath` with `process.env` + `join(grove root, "runtime")`) and a `claudeVersion` impl that runs `<path> --version` via the runner, with `expected = CLAUDE_SDK_VERSION`, and push the result into `checks`. (Import `resolveClaudePath`, `CLAUDE_SDK_VERSION`, and resolve the runtime dir from the paths the doctor already has, or `resolvePaths`. If `runDoctor` has no paths, add an optional `paths`/`env` parameter defaulting to `resolvePaths()`/`process.env` — keep the existing call sites working by defaulting.)

- [ ] **Step 4: Run tests + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/doctor-runtime.test.ts && bun test && bun run typecheck`
Expected: target 3 pass; full suite all pass (existing doctor tests still pass — the new check is additive); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/doctor.ts test/cli/doctor-runtime.test.ts
git commit -m "feat: add claude-runtime check to grove doctor"
```

---

## Task 7: `SdkAgentRunner` + run/TUI wiring

**Files:** Modify `src/agent/sdk-agent-runner.ts`, `src/cli/run-driver.ts`, `src/cli/index.ts`. Tests: `test/agent/sdk-runner-claude-path.test.ts`, and a run-driver precheck test.

- [ ] **Step 1: Write the failing tests**

`test/agent/sdk-runner-claude-path.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { SdkAgentRunner } from "../../src/agent/sdk-agent-runner.ts";
import type { PhaseContext } from "../../src/agent/events.ts";

function ctx(): PhaseContext {
  return { taskId: "t", title: "x", worktreePath: "/wt", model: "m", priorArtifacts: [] };
}

async function drain(runner: SdkAgentRunner, captured: { opts?: any }) {
  const gen = runner.run("brainstorm", ctx());
  // exhaust the generator so run() builds and calls queryFn
  // queryFn returns an empty async iterable, then run() returns its PhaseResult
  let r = await gen.next();
  while (!r.done) r = await gen.next();
}

function fakeQuery(captured: { opts?: any }) {
  return ((arg: any) => {
    captured.opts = arg.options;
    return (async function* () {})();
  }) as any;
}

test("passes pathToClaudeCodeExecutable when a claude path is set", async () => {
  const captured: { opts?: any } = {};
  const runner = new SdkAgentRunner({ queryFn: fakeQuery(captured), env: {}, claudePath: "/home/.grove/runtime/claude" });
  await drain(runner, captured);
  expect(captured.opts.pathToClaudeCodeExecutable).toBe("/home/.grove/runtime/claude");
});

test("omits pathToClaudeCodeExecutable when no claude path (dev: SDK self-resolves)", async () => {
  const captured: { opts?: any } = {};
  const runner = new SdkAgentRunner({ queryFn: fakeQuery(captured), env: {}, claudePath: null });
  await drain(runner, captured);
  expect("pathToClaudeCodeExecutable" in captured.opts).toBe(false);
});
```

Add to `test/cli/run-driver.test.ts` (it has the `deps(over)` helper and `runTask`):
```typescript
test("fails fast when the claude runtime is missing", async () => {
  let started = false;
  const e = { async startTask() { started = true; return null as any; }, async confirmGate() { return null as any; }, subscribe() { return () => {}; } };
  const res = await runTask("add a page", deps({ hasClaudeRuntime: false, engine: e as any }));
  expect(res.ok).toBe(false);
  expect(res.message.toLowerCase()).toContain("install-runtime");
  expect(started).toBe(false);
});
```
(The existing `deps(over)` helper provides `hasClaudeRuntime: true` by default once added in Step 3 — update the helper to include it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/agent/sdk-runner-claude-path.test.ts test/cli/run-driver.test.ts`
Expected: FAIL — `claudePath` option / `hasClaudeRuntime` precheck not present.

- [ ] **Step 3: Implement**

`src/agent/sdk-agent-runner.ts`: add `claudePath?: string | null` to `SdkAgentRunnerOptions`; store it; in `run()`'s `options` object, conditionally include it:
```typescript
        options: {
          systemPrompt: { type: "preset", preset: "claude_code", append: def.systemPromptAppend },
          cwd: ctx.worktreePath,
          model: ctx.model,
          maxTurns: def.maxTurns,
          permissionMode: "bypassPermissions",
          includePartialMessages: true,
          ...(this.claudePath ? { pathToClaudeCodeExecutable: this.claudePath } : {}),
          env: { ...this.env, ...credentialEnv(this.env) },
        },
```
(Constructor: `this.claudePath = opts.claudePath ?? null;`)

`src/cli/run-driver.ts`: add `hasClaudeRuntime: boolean` to `RunDeps`; in `runTask`, after the credential precheck, add:
```typescript
  if (!deps.hasClaudeRuntime) {
    return { ok: false, message: "claude runtime not installed — run `grove install-runtime`" };
  }
```
Update the test helper's default `deps` to include `hasClaudeRuntime: true`.

`src/cli/index.ts`: in BOTH the `run` case and `launchTui`, compute the claude path and gate on it:
```typescript
  const runtimeDir = join(paths.root, "runtime");
  const claudePath = resolveClaudePath({ env: process.env, runtimeDir });
```
- In `launchTui`: after the credential gate, add — `if (!claudePath) { console.log("claude runtime not installed — run `grove install-runtime`"); return 1; }` — and build the agent with `new SdkAgentRunner({ env: process.env, claudePath })`.
- In the `run` case: pass `hasClaudeRuntime: claudePath !== null` into `runTask`'s deps and build the agent with `new SdkAgentRunner({ env: process.env, claudePath })`.
Add `import { resolveClaudePath } from "../agent/claude-binary.ts";`.

- [ ] **Step 4: Run tests + full suite + typecheck + build**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck && bun run build && echo built`
Expected: all pass (flag-gated skips unchanged); typecheck clean; binary compiles (and `dist/grove --version` works). Confirm the existing run-driver tests still pass (their `deps` now include `hasClaudeRuntime: true`).

- [ ] **Step 5: Commit**

```bash
git add src/agent/sdk-agent-runner.ts src/cli/run-driver.ts src/cli/index.ts test/agent/sdk-runner-claude-path.test.ts test/cli/run-driver.test.ts
git commit -m "feat: pass resolved claude path to the SDK and precheck the runtime in run/TUI"
```

---

## Self-Review (completed during planning)

**Spec coverage (Packaging-1 slice — spec §4 components A–D + the runner/precheck wiring, §6 error handling, §7 testing):**
- A `resolveClaudePath` → Task 1 ✓
- B `CLAUDE_SDK_VERSION` + prebuild → Task 2 ✓
- C platform mapping + `installRuntime` + `grove install-runtime` → Tasks 3–5 ✓ (retry, idempotent version marker, unsupported-platform + fetch-failure handling → §6)
- D doctor claude-runtime check (present / missing-with-hint / version-mismatch warn) → Task 6 ✓ (§6 version-skew warn-don't-block)
- SdkAgentRunner `pathToClaudeCodeExecutable` only when set; run/TUI runtime precheck → Task 7 ✓ (§6 missing-claude fail-fast)
- Testing: all IO injected; no real network in the suite (§7) → every task uses fakes ✓

**Deferred to Packaging-2 (not gaps):** the build matrix, `install.sh`, brew tap, release workflow (spec §4 E–H, §5 Packaging-2). Real end-to-end fetch is exercised manually / by the gated `GROVE_E2E` job in Packaging-2 — Task 4/5 unit-test the orchestration with fakes.

**Placeholder scan:** none — every code/test step is complete.

**Type consistency:** `ResolveClaudeDeps`/`resolveClaudePath` (Task 1) reused by doctor (Task 6) and index wiring (Task 7). `PlatformInfo`/`detectPlatform`/`platformPackage`/`tarballUrl` (Task 3) consumed by `installRuntime` (Task 4) and `runInstallRuntime` (Task 5). `InstallRuntimeDeps`/`InstallRuntimeResult` (Task 4) used by the CLI wiring (Task 5). `CLAUDE_SDK_VERSION` (Task 2) used by Tasks 5–7. `SdkAgentRunnerOptions.claudePath` (Task 7) set from `resolveClaudePath`. `RunDeps.hasClaudeRuntime` (Task 7) mirrors the existing `hasCredential`.
