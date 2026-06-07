# grove — Release Packaging Design

**Status:** Approved (brainstorm) — 2026-06-07
**Goal:** Ship grove as an installable CLI on macOS + Linux (`brew install` / `curl | sh`), including the native `claude` binary the Agent SDK drives.

---

## 1. Problem

grove is a Bun/TypeScript CLI compiled with `bun build --compile` to a single ~63 MB binary. But it orchestrates the **Claude Agent SDK**, which at runtime spawns a separate **native `claude` binary** shipped as a platform-specific npm package (`@anthropic-ai/claude-agent-sdk-<platform>`, ~225 MB). `bun build --compile` bundles JS only — **not** that sibling native binary. So a standalone `dist/grove` fails the moment a phase runs, because `node_modules` (and the `claude` binary) are gone.

The SDK exposes a supported hook — **`pathToClaudeCodeExecutable`** — to point it at a `claude` binary anywhere. This design uses that hook plus an install-time fetch of the version-pinned binary.

## 2. Decisions (from brainstorming)

- **claude-binary strategy:** the **installer fetches** the pinned `claude` from Anthropic's npm registry at install time (not bundled into grove's releases, not relying on a user's existing `claude`). Rationale: grove stays small + standalone; the SDK pins an exact `claude` version (fetching *that* guarantees protocol compatibility and avoids version skew from a random PATH `claude`); no 225 MB redistribution in grove's releases.
- **Scope:** macOS + Linux — **4 targets**: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`. Windows is deferred (separate effort: PowerShell installer + an OS-abstraction pass through the Unix-centric infra layer — `df`/`du`/`git`/`docker`).
- **Channels:** a `curl | sh` installer **and** a Homebrew tap (`g4lb/homebrew-tap`), both pulling per-platform binaries from GitHub Releases.
- **Fetch source:** the npm registry tarball (`registry.npmjs.org`) via `curl`+`tar` — no `npm` required.

## 3. Architecture & flow

```
INSTALL (curl | brew)
  detect os/arch → download grove binary from GitHub Release → ~/.grove/bin/grove (on PATH)
                 → grove install-runtime → fetch claude@<pinned> tarball from npm registry
                                         → extract to ~/.grove/runtime/claude (chmod +x)
RUNTIME
  SdkAgentRunner → resolveClaudePath() → pathToClaudeCodeExecutable
       order: $GROVE_CLAUDE_PATH  →  <grove-home>/runtime/claude  →  `claude` on PATH  →  null (dev: SDK self-resolves)
DOCTOR
  grove doctor → verifies claude present + runnable (+ version match); `grove install-runtime` / `doctor --fix` (re)fetches
```

**Version pinning is the linchpin.** grove embeds at build time the exact `@anthropic-ai/claude-agent-sdk` version it was compiled against (`CLAUDE_SDK_VERSION`); the fetcher pulls exactly that `claude`, so grove ↔ claude are always protocol-compatible.

## 4. Components

| ID | File / artifact | Responsibility |
|---|---|---|
| A | `src/agent/claude-binary.ts` | `resolveClaudePath(env, paths): string \| null` — first existing & executable of `$GROVE_CLAUDE_PATH` → `<root>/runtime/claude` → `claude` on PATH → `null`. Pure; injected fs/`which`. |
| B | `src/agent/sdk-version.ts` | A generated constant `CLAUDE_SDK_VERSION` = the exact built-against SDK version. A prebuild step writes it from `package.json`/lockfile; the committed value is kept in sync. |
| C | `src/runtime/fetch-claude.ts` + `grove install-runtime` | Map os/arch → platform package; download the npm tarball for `@anthropic-ai/claude-agent-sdk-<platform>@<CLAUDE_SDK_VERSION>`; extract `package/claude` → `<root>/runtime/claude`; `chmod +x`; verify it runs. Idempotent (skip if present & correct). Used by the installer **and** `doctor --fix`. |
| D | `src/cli/doctor.ts` (extend) | Add a "claude runtime" check: present + executable + version matches. On failure → message to run `grove install-runtime`. `grove doctor --fix` invokes the fetcher. |
| E | `scripts/build-all.ts` + npm scripts | `bun build --compile --target=bun-<t>` for the 4 targets → `dist/grove-<os>-<arch>` + `dist/SHASUMS256.txt`. |
| F | `.github/workflows/release.yml` | On a `v*` tag: run the prebuild (write `sdk-version.ts`), build the 4 targets, generate checksums, create a GitHub Release with the 4 binaries + `SHASUMS256.txt` + `install.sh`. |
| G | `install.sh` (POSIX sh) | Detect os/arch → download `grove-<os>-<arch>` from the release → verify checksum → install to `~/.grove/bin/grove` → print a PATH hint → run `grove install-runtime`. `shellcheck`-clean; supports `--dry-run`. |
| H | `Formula/grove.rb` (in `g4lb/homebrew-tap`) | Per-arch `url`+`sha256` for the macOS/Linux binaries; `def install` places the binary; a `post_install`/caveat runs `grove install-runtime`. |

**SdkAgentRunner change:** accept a resolved claude path (via an injected resolver defaulting to `resolveClaudePath`) and pass it as `pathToClaudeCodeExecutable` **only when non-null** (so dev with `node_modules` is unchanged).

**Runtime precheck:** `grove run` and `launchTui` gain a "claude runtime present" precheck beside the existing credential precheck — fail fast with "claude runtime not installed — run `grove install-runtime`" rather than a cryptic SDK spawn error.

## 5. Decomposition (two implementation plans)

- **Packaging-1 — Runtime code (in-repo, TDD):** A (resolver), B (version pin + prebuild), C (fetcher + `install-runtime`), D (doctor), and the SdkAgentRunner wiring + run/TUI precheck.
- **Packaging-2 — Distribution (ops/scripts):** E (build matrix), F (release workflow), G (`install.sh`), H (brew tap). Lighter on unit tests; verified by `shellcheck`, a `--dry-run`, and a CI build-and-smoke job.

## 6. Error handling

- **Fetch failure (network/registry):** retry a few times with backoff, then exit non-zero with a clear message (registry URL + `grove install-runtime` hint). The installer leaves grove installed so the fetch can be retried later.
- **Checksum mismatch** (grove binary in `install.sh`; claude tarball integrity): abort — never install an unverified binary.
- **Missing claude at runtime:** `resolveClaudePath → null` → fail fast with the install-runtime message (same shape as the credential precheck).
- **Version skew** (claude present but ≠ `CLAUDE_SDK_VERSION`): `doctor` warns + offers `--fix`; runtime proceeds (warn, don't block).
- **Unsupported platform** (Windows / unknown arch): installer + fetcher exit with an explicit "unsupported platform" message listing the supported set.

## 7. Testing

- **Unit (TDD, in-repo, no real network):** `resolveClaudePath` precedence (env → runtime dir → PATH → null) with fake fs/`which`; platform→package-name + registry-URL builder; the fetcher against a fake downloader + fake fs (success / retry / checksum-fail / idempotent-skip); doctor's new check (present / missing / version-mismatch); SdkAgentRunner passing `pathToClaudeCodeExecutable` only when resolved (inject the resolver).
- **Scripts:** `install.sh` via `shellcheck` + a `--dry-run` (detect+plan, no download) exercised in CI.
- **CI build job:** build all 4 targets; run `./grove-<host> --version` + `grove doctor` (no-runtime branch) on macOS + Linux runners; an optional gated job that actually fetches `claude` and runs the existing flag-gated E2E (`GROVE_E2E=1`).
- All fetch/IO behind injected interfaces — same discipline as the rest of grove.

## 8. Out of scope / deferred

Windows support; auto-update; signing/notarization (macOS Gatekeeper) — note as a follow-up so the curl/brew binary isn't quarantined; shipping grove itself to npm. These can layer on later without reworking this design.
