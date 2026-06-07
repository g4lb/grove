# grove — Packaging-2: Distribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make grove installable on macOS + Linux — a 4-target build matrix, a `curl | sh` installer, a Homebrew formula, a tag-triggered GitHub release workflow, and PR CI. Builds on Packaging-1 (the runtime code + `grove install-runtime`, already merged).

**Architecture:** Distribution is ops/scripts, so the testable *logic* (target list, build orchestration, platform→asset mapping, install planning) is extracted into small pure/injected functions and unit-tested; the shell + YAML glue is verified by `shellcheck`, a `--dry-run` path, and a CI build-and-smoke job. The release publishes per-platform binaries + `SHASUMS256.txt`; the installer downloads, checksum-verifies, installs grove, then runs `grove install-runtime` to fetch the pinned `claude`.

**Tech Stack:** Bun (`bun build --compile --target=...`), POSIX sh, GitHub Actions, Homebrew (Ruby formula). Spec: `docs/superpowers/specs/2026-06-07-grove-release-packaging-design.md` (§4 E–H, §5 Packaging-2, §7).

---

## Context for the implementer (read once)

- Packaging-1 is merged: `grove install-runtime` fetches the pinned `claude`; `scripts/write-sdk-version.ts` regenerates `src/agent/sdk-version.ts`; `package.json` `build` runs it then `bun build --compile`.
- Bun cross-compiles from one host: `bun build ./src/cli/index.ts --compile --target=bun-<os>-<arch> --outfile <path>`. Targets used: `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`, `bun-linux-arm64` (glibc; musl-grove deferred).
- Repo: `g4lb/grove` (private). `Bun.CryptoHasher("sha256")` + `Bun.spawn`. `Bun.file(path).arrayBuffer()` reads a file.
- Imports use explicit `.ts` extensions. TDD where logic exists; `shellcheck`/`--dry-run`/CI for the glue.

**Environment quirk:** bun is at `~/.bun/bin/bun`, NOT on PATH. Prepend `export PATH="$HOME/.bun/bin:$PATH";` to every bun command. Verify `bun --version` → `1.3.14`. `shellcheck` may not be installed locally — if `command -v shellcheck` is empty, note it and rely on the CI step (do not block).

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/build-all.ts` | `TARGETS` + `buildAll(deps)` — build the 4 targets + `SHASUMS256.txt` |
| `src/runtime/install-plan.ts` | `planInstall(unameS, unameM, version)` — map uname → asset name + URLs (testable installer logic) |
| `install.sh` | POSIX `curl | sh` installer (detect → download → verify → install → `grove install-runtime`); `--dry-run` |
| `packaging/homebrew/grove.rb` | Homebrew formula (per-arch url+sha256; caveat runs `install-runtime`) |
| `.github/workflows/release.yml` | on `v*` tag: build 4 targets, checksum, GitHub Release |
| `.github/workflows/ci.yml` | on PR/push: `bun test` + typecheck + `shellcheck install.sh` + host build smoke |
| `package.json` | add `build:all` script |

---

## Task 1: `build-all` matrix

**Files:** Create `scripts/build-all.ts`, Test `test/scripts/build-all.test.ts`, modify `package.json`.

- [ ] **Step 1: Write the failing test**

`test/scripts/build-all.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { TARGETS, buildAll, type BuildAllDeps } from "../../scripts/build-all.ts";

test("TARGETS covers macOS + Linux on arm64 + x64", () => {
  expect(TARGETS.map((t) => t.outfile).sort()).toEqual([
    "grove-darwin-arm64",
    "grove-darwin-x64",
    "grove-linux-arm64",
    "grove-linux-x64",
  ]);
  for (const t of TARGETS) expect(t.target).toMatch(/^bun-(darwin|linux)-(arm64|x64)$/);
});

test("buildAll builds every target and writes a SHASUMS file with one line per binary", async () => {
  const builds: Array<{ target: string; out: string }> = [];
  let checksums = "";
  let checksumPath = "";
  const deps: BuildAllDeps = {
    outDir: "/dist",
    build: async (target, out) => { builds.push({ target, out }); },
    sha256: async (file) => `sha_${file.split("/").pop()}`,
    writeChecksums: (path, content) => { checksumPath = path; checksums = content; },
  };
  const built = await buildAll(deps);

  expect(builds.length).toBe(4);
  expect(built).toEqual(["grove-darwin-arm64", "grove-darwin-x64", "grove-linux-x64", "grove-linux-arm64"]);
  expect(checksumPath).toBe("/dist/SHASUMS256.txt");
  // sha256sum format: "<hash>  <filename>" per line
  expect(checksums.trim().split("\n").length).toBe(4);
  expect(checksums).toContain("sha_grove-linux-x64  grove-linux-x64");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/scripts/build-all.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

`scripts/build-all.ts`:
```typescript
import { join } from "node:path";
import { writeFileSync } from "node:fs";

export interface BuildTarget {
  target: string;
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
  outfile: string;
}

export const TARGETS: BuildTarget[] = [
  { target: "bun-darwin-arm64", os: "darwin", arch: "arm64", outfile: "grove-darwin-arm64" },
  { target: "bun-darwin-x64", os: "darwin", arch: "x64", outfile: "grove-darwin-x64" },
  { target: "bun-linux-x64", os: "linux", arch: "x64", outfile: "grove-linux-x64" },
  { target: "bun-linux-arm64", os: "linux", arch: "arm64", outfile: "grove-linux-arm64" },
];

export interface BuildAllDeps {
  outDir: string;
  build: (target: string, outfile: string) => Promise<void>;
  sha256: (filePath: string) => Promise<string>;
  writeChecksums: (path: string, content: string) => void;
}

/** Build every target into outDir and write a sha256sum-format SHASUMS256.txt. Returns built filenames. */
export async function buildAll(deps: BuildAllDeps): Promise<string[]> {
  const lines: string[] = [];
  const built: string[] = [];
  for (const t of TARGETS) {
    const out = join(deps.outDir, t.outfile);
    await deps.build(t.target, out);
    const sha = await deps.sha256(out);
    lines.push(`${sha}  ${t.outfile}`);
    built.push(t.outfile);
  }
  deps.writeChecksums(join(deps.outDir, "SHASUMS256.txt"), lines.join("\n") + "\n");
  return built;
}

// Real entrypoint (not run under test).
if (import.meta.main) {
  const outDir = "dist";
  await buildAll({
    outDir,
    build: async (target, out) => {
      const proc = Bun.spawn(
        ["bun", "build", "./src/cli/index.ts", "--compile", `--target=${target}`, "--outfile", out],
        { stdout: "inherit", stderr: "inherit" },
      );
      if ((await proc.exited) !== 0) throw new Error(`build failed for ${target}`);
    },
    sha256: async (file) => {
      const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
      return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    },
    writeChecksums: (path, content) => writeFileSync(path, content),
  });
  console.log("built all targets + SHASUMS256.txt");
}
```

- [ ] **Step 4: Run test + add the script**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/scripts/build-all.test.ts` → 2 pass.
In `package.json` add to `scripts`:
```json
    "build:all": "bun scripts/write-sdk-version.ts && bun scripts/build-all.ts",
```

- [ ] **Step 5: Run the full suite + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-all.ts test/scripts/build-all.test.ts package.json
git commit -m "feat: add build-all matrix (4 targets + SHASUMS256)"
```

---

## Task 2: installer planning logic

**Files:** Create `src/runtime/install-plan.ts`, Test `test/runtime/install-plan.test.ts`.

The pure logic the shell installer needs (uname → asset + URLs), so it's unit-tested even though the shell glue isn't.

- [ ] **Step 1: Write the failing test**

`test/runtime/install-plan.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { planInstall } from "../../src/runtime/install-plan.ts";

test("maps uname to the release asset name", () => {
  expect(planInstall("Darwin", "arm64", "latest")!.asset).toBe("grove-darwin-arm64");
  expect(planInstall("Darwin", "x86_64", "latest")!.asset).toBe("grove-darwin-x64");
  expect(planInstall("Linux", "x86_64", "latest")!.asset).toBe("grove-linux-x64");
  expect(planInstall("Linux", "aarch64", "latest")!.asset).toBe("grove-linux-arm64");
});

test("builds latest vs versioned download URLs", () => {
  const latest = planInstall("Linux", "x86_64", "latest")!;
  expect(latest.binaryUrl).toBe("https://github.com/g4lb/grove/releases/latest/download/grove-linux-x64");
  expect(latest.checksumsUrl).toBe("https://github.com/g4lb/grove/releases/latest/download/SHASUMS256.txt");

  const tagged = planInstall("Linux", "x86_64", "v1.2.3")!;
  expect(tagged.binaryUrl).toBe("https://github.com/g4lb/grove/releases/download/v1.2.3/grove-linux-x64");
});

test("returns null for unsupported os/arch", () => {
  expect(planInstall("Windows_NT", "x86_64", "latest")).toBe(null);
  expect(planInstall("Linux", "ppc64", "latest")).toBe(null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/runtime/install-plan.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

`src/runtime/install-plan.ts`:
```typescript
const REPO = "g4lb/grove";

export interface InstallPlan {
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
  asset: string;
  binaryUrl: string;
  checksumsUrl: string;
}

/** Map `uname -s`/`uname -m` to a release asset + download URLs, or null if unsupported. */
export function planInstall(unameS: string, unameM: string, version: string): InstallPlan | null {
  const os = unameS === "Darwin" ? "darwin" : unameS === "Linux" ? "linux" : null;
  const arch =
    unameM === "arm64" || unameM === "aarch64" ? "arm64" : unameM === "x86_64" || unameM === "amd64" ? "x64" : null;
  if (!os || !arch) return null;

  const asset = `grove-${os}-${arch}`;
  const base =
    version === "latest"
      ? `https://github.com/${REPO}/releases/latest/download`
      : `https://github.com/${REPO}/releases/download/${version}`;
  return { os, arch, asset, binaryUrl: `${base}/${asset}`, checksumsUrl: `${base}/SHASUMS256.txt` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/runtime/install-plan.test.ts`
Expected: PASS — 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/install-plan.ts test/runtime/install-plan.test.ts
git commit -m "feat: add installer planning (uname -> asset + URLs)"
```

---

## Task 3: `install.sh`

**Files:** Create `install.sh`, Test `test/scripts/install-sh.test.ts`.

POSIX installer with a `--dry-run` that prints the plan without downloading; uname/version overridable via env for tests. Mirrors `planInstall`'s mapping.

- [ ] **Step 1: Write the failing test**

`test/scripts/install-sh.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { join } from "node:path";

const SH = join(import.meta.dir, "..", "..", "install.sh");

async function dryRun(env: Record<string, string>) {
  const proc = Bun.spawn(["sh", SH, "--dry-run"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, out };
}

test("dry-run prints the planned asset + URL for the (overridden) platform", async () => {
  const { code, out } = await dryRun({ GROVE_FORCE_OS: "Linux", GROVE_FORCE_ARCH: "x86_64" });
  expect(code).toBe(0);
  expect(out).toContain("grove-linux-x64");
  expect(out).toContain("https://github.com/g4lb/grove/releases/latest/download/grove-linux-x64");
});

test("dry-run honors GROVE_VERSION for a tagged URL", async () => {
  const { out } = await dryRun({ GROVE_FORCE_OS: "Darwin", GROVE_FORCE_ARCH: "arm64", GROVE_VERSION: "v0.1.0" });
  expect(out).toContain("https://github.com/g4lb/grove/releases/download/v0.1.0/grove-darwin-arm64");
});

test("exits non-zero with a message on an unsupported platform", async () => {
  const { code, out } = await dryRun({ GROVE_FORCE_OS: "Windows_NT", GROVE_FORCE_ARCH: "x86_64" });
  expect(code).not.toBe(0);
  expect(out.toLowerCase()).toContain("unsupported");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/scripts/install-sh.test.ts`
Expected: FAIL — `install.sh` missing.

- [ ] **Step 3: Write `install.sh`**

```sh
#!/bin/sh
# grove installer — downloads the grove binary, verifies it, and fetches the claude runtime.
set -eu

REPO="g4lb/grove"
GROVE_HOME="${GROVE_HOME:-$HOME/.grove}"
BIN_DIR="$GROVE_HOME/bin"
VERSION="${GROVE_VERSION:-latest}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

uname_s="${GROVE_FORCE_OS:-$(uname -s)}"
uname_m="${GROVE_FORCE_ARCH:-$(uname -m)}"

case "$uname_s" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  *) echo "grove: unsupported OS: $uname_s (supported: macOS, Linux)" >&2; exit 1 ;;
esac
case "$uname_m" in
  arm64 | aarch64) ARCH=arm64 ;;
  x86_64 | amd64) ARCH=x64 ;;
  *) echo "grove: unsupported architecture: $uname_m" >&2; exit 1 ;;
esac

ASSET="grove-$OS-$ARCH"
if [ "$VERSION" = "latest" ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  BASE="https://github.com/$REPO/releases/download/$VERSION"
fi
BIN_URL="$BASE/$ASSET"
SUM_URL="$BASE/SHASUMS256.txt"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "grove: would install $ASSET"
  echo "  binary:    $BIN_URL"
  echo "  checksums: $SUM_URL"
  echo "  into:      $BIN_DIR/grove"
  exit 0
fi

echo "grove: installing $ASSET …"
mkdir -p "$BIN_DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# download
curl -fsSL "$BIN_URL" -o "$tmp/grove"
curl -fsSL "$SUM_URL" -o "$tmp/SHASUMS256.txt"

# verify checksum (sha256sum on Linux, shasum -a 256 on macOS)
expected="$(grep " $ASSET\$" "$tmp/SHASUMS256.txt" | awk '{print $1}')"
if [ -z "$expected" ]; then echo "grove: no checksum for $ASSET" >&2; exit 1; fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/grove" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$tmp/grove" | awk '{print $1}')"
fi
if [ "$expected" != "$actual" ]; then
  echo "grove: checksum mismatch for $ASSET" >&2
  exit 1
fi

# install
chmod +x "$tmp/grove"
mv "$tmp/grove" "$BIN_DIR/grove"
echo "grove: installed to $BIN_DIR/grove"

# PATH hint
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "grove: add to your PATH →  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac

# fetch the claude runtime
echo "grove: fetching the claude runtime …"
"$BIN_DIR/grove" install-runtime || echo "grove: run 'grove install-runtime' later to finish setup"

echo "grove: done. Run 'grove' to start."
```

- [ ] **Step 4: Run the test + shellcheck**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/scripts/install-sh.test.ts` → 3 pass.
If shellcheck is available, run `shellcheck install.sh` and fix any warnings. If `command -v shellcheck` is empty, note it (CI covers it in Task 5).

- [ ] **Step 5: Commit**

```bash
git add install.sh test/scripts/install-sh.test.ts
git commit -m "feat: add curl install.sh (detect, download, verify, install-runtime)"
```

---

## Task 4: Homebrew formula

**Files:** Create `packaging/homebrew/grove.rb`, Test `test/scripts/brew-formula.test.ts`.

A formula template for the `g4lb/homebrew-tap` repo. `version`/`sha256`s are filled at release (Task 5 prints them); a structural test guards the required stanzas.

- [ ] **Step 1: Write the failing test**

`test/scripts/brew-formula.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FORMULA = readFileSync(join(import.meta.dir, "..", "..", "packaging", "homebrew", "grove.rb"), "utf8");

test("formula declares the class, homepage, and per-arch macOS + Linux assets", () => {
  expect(FORMULA).toContain("class Grove < Formula");
  expect(FORMULA).toMatch(/on_macos/);
  expect(FORMULA).toMatch(/on_linux/);
  expect(FORMULA).toContain("grove-darwin-arm64");
  expect(FORMULA).toContain("grove-darwin-x64");
  expect(FORMULA).toContain("grove-linux-x64");
  expect(FORMULA).toContain("grove-linux-arm64");
});

test("formula installs the binary as `grove` and tells the user to run install-runtime", () => {
  expect(FORMULA).toMatch(/bin\.install.*=> "grove"/);
  expect(FORMULA.toLowerCase()).toContain("install-runtime");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/scripts/brew-formula.test.ts`
Expected: FAIL — file missing.

- [ ] **Step 3: Write `packaging/homebrew/grove.rb`**

```ruby
# Homebrew formula for grove. Lives in the g4lb/homebrew-tap repo.
# Bump `version` and the four `sha256` values on each release (the release workflow prints them).
class Grove < Formula
  desc "Orchestrates AI-driven development in isolated environments"
  homepage "https://github.com/g4lb/grove"
  version "0.0.0"

  on_macos do
    on_arm do
      url "https://github.com/g4lb/grove/releases/download/v#{version}/grove-darwin-arm64"
      sha256 "REPLACE_DARWIN_ARM64_SHA256"
    end
    on_intel do
      url "https://github.com/g4lb/grove/releases/download/v#{version}/grove-darwin-x64"
      sha256 "REPLACE_DARWIN_X64_SHA256"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/g4lb/grove/releases/download/v#{version}/grove-linux-arm64"
      sha256 "REPLACE_LINUX_ARM64_SHA256"
    end
    on_intel do
      url "https://github.com/g4lb/grove/releases/download/v#{version}/grove-linux-x64"
      sha256 "REPLACE_LINUX_X64_SHA256"
    end
  end

  def install
    bin.install Dir["grove-*"].first => "grove"
  end

  def caveats
    <<~EOS
      grove needs its claude runtime. Finish setup with:
        grove install-runtime
    EOS
  end

  test do
    assert_match "0.0.1", shell_output("#{bin}/grove --version")
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/scripts/brew-formula.test.ts`
Expected: PASS — 2 pass.

- [ ] **Step 5: Commit**

```bash
git add packaging/homebrew/grove.rb test/scripts/brew-formula.test.ts
git commit -m "feat: add Homebrew formula template"
```

---

## Task 5: Release + CI workflows

**Files:** Create `.github/workflows/release.yml`, `.github/workflows/ci.yml`.

- [ ] **Step 1: Write `.github/workflows/ci.yml`** (PR/push checks)

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"
      - run: bun install --frozen-lockfile
      - run: bun test
      - run: bun run typecheck
      - name: shellcheck install.sh
        run: shellcheck install.sh
      - name: host build smoke
        run: |
          bun run build
          ./dist/grove --version
```

- [ ] **Step 2: Write `.github/workflows/release.yml`** (tag → release)

```yaml
name: release
on:
  push:
    tags: ["v*"]
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"
      - run: bun install --frozen-lockfile
      - name: build all targets
        run: bun run build:all
      - name: show checksums
        run: cat dist/SHASUMS256.txt
      - name: create release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            dist/grove-darwin-arm64
            dist/grove-darwin-x64
            dist/grove-linux-x64
            dist/grove-linux-arm64
            dist/SHASUMS256.txt
            install.sh
```

- [ ] **Step 3: Validate the YAML**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun -e "import {readFileSync} from 'node:fs'; for (const f of ['.github/workflows/ci.yml','.github/workflows/release.yml']) { const s = readFileSync(f,'utf8'); if (!s.includes('jobs:')) throw new Error('bad '+f); } console.log('workflows present')"`
Expected: prints `workflows present`. If `actionlint` is available, run it on both files and fix issues; otherwise rely on GitHub's own validation on push.

- [ ] **Step 4: Run the full suite + typecheck (sanity)**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck`
Expected: all pass; typecheck clean (no source changed this task, but confirm nothing broke).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci: add PR checks and a tag-triggered release workflow"
```

---

## Self-Review (completed during planning)

**Spec coverage (Packaging-2 — spec §4 E–H, §5, §7):**
- E build matrix (4 targets + SHASUMS256) → Task 1 ✓
- F release workflow (tag → build → checksum → GitHub Release with binaries + SHASUMS + install.sh) → Task 5 ✓
- G `install.sh` (detect → download → checksum-verify → install → `grove install-runtime`; `--dry-run`) → Tasks 2–3 ✓; checksum-mismatch abort (§6) → Task 3 ✓; unsupported-platform message (§6) → Tasks 2–3 ✓
- H Homebrew formula (per-arch url+sha256; caveat runs `install-runtime`) → Task 4 ✓
- Testing (§7): `build-all`/`planInstall` unit-tested; `install.sh` via `--dry-run` test + `shellcheck`; CI build-and-smoke job → Tasks 1–5 ✓

**Intentionally deferred (not gaps):** musl-grove binary (grove's own compiled binary is glibc; the *claude* fetch already handles musl) — Alpine users can use `GROVE_CLAUDE_PATH`/a glibc shim, full musl-grove later; macOS signing/notarization (Gatekeeper may quarantine the curl/brew binary) — noted in spec §8 as a follow-up; auto-update; publishing the formula to the actual `g4lb/homebrew-tap` repo + filling its sha256s is a release-time action (the workflow prints `SHASUMS256.txt`; a future step can auto-PR the tap).

**Placeholder scan:** the formula's `REPLACE_*_SHA256` + `version "0.0.0"` are intentional release-time fills (documented in-file), not plan placeholders. Every code/test step is complete.

**Type consistency:** `TARGETS`/`BuildTarget`/`BuildAllDeps`/`buildAll` (Task 1) are self-contained. `planInstall`/`InstallPlan` (Task 2) mirror `install.sh`'s uname mapping (Task 3) and the `build-all` asset names (`grove-<os>-<arch>`) — the same naming flows through the release assets (Task 5) and the formula (Task 4). `SHASUMS256.txt` (sha256sum format: `<hash>␠␠<file>`) is produced by `buildAll` and consumed by `install.sh`'s `grep " $ASSET$" | awk '{print $1}'`.
