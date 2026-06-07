# grove 🌳

**Orchestrate AI-driven development in isolated environments — from your terminal.**

grove is a standalone CLI that turns a free-text request ("add a settings page", "fix the login crash") into a checkpoint-gated workflow run by the Claude agent, each task isolated in its own git worktree + Docker Compose project. You stay in control: grove pauses at every gate so you approve, request changes, or stop.

```
$ grove
› add a dark-mode toggle to settings
  detected: task
  · Write  · Edit
  gate — brainstorm done
  [a]pprove / [r]equest changes / [s]top
```

---

## How it works

Each task runs a five-phase workflow, pausing for your confirmation at three gates:

```
brainstorm ─▸│gate│─▸ plan ─▸│gate│─▸ execute ─▸ review ─▸│gate│─▸ finish
```

- **Isolation per task** — a dedicated git **worktree** (your main checkout is never touched) and a **Docker Compose** project for services, torn down on finish. `grove gc` reclaims anything orphaned (it only ever touches `grove-`-labeled resources).
- **Crash-safe engine** — every state transition is persisted before returning, so a task can be resumed.
- **Two front-ends, one engine** — the interactive TUI (`grove`) and the headless driver (`grove run`) are parallel consumers of the same engine.

## Requirements

- **git** and **Docker** (with `docker compose`)
- An **Anthropic credential**: `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`
- The **claude runtime** — grove fetches the pinned native binary via `grove install-runtime` (the installer does this for you)

Run `grove doctor` any time to check all of the above.

## Install

**One-liner** (macOS + Linux):

```sh
curl -fsSL https://github.com/g4lb/grove/releases/latest/download/install.sh | sh
```

This downloads the right binary for your platform, verifies its checksum, installs it to `~/.grove/bin/grove`, and fetches the pinned `claude` runtime. Add `~/.grove/bin` to your `PATH` if prompted.

**Homebrew:**

```sh
brew install g4lb/tap/grove
```

**From source** (Bun required):

```sh
git clone https://github.com/g4lb/grove && cd grove
bun install
bun run build                  # → dist/grove
./dist/grove install-runtime
```

Supported platforms: **macOS** (arm64/x64) and **Linux** (x64/arm64).

## Usage

Launch the TUI:

```sh
grove
```

- Type a request and press **Enter**.
- Watch the agent work; at each gate press **`a`** (approve), **`r`** (request changes — then type feedback), or **`s`** (stop).
- **`/list`** shows all tasks (status · kind · phase · title); **`/open <id>`** revisits one; **Esc** goes back.

Run headlessly (great for scripts/CI):

```sh
grove run "add a /health endpoint"          # interactive gates on stdin
grove run "add a /health endpoint" --yes    # auto-approve every gate
```

### Commands

| Command | Description |
|---|---|
| `grove` | Launch the interactive TUI |
| `grove run "<prose>" [--yes]` | Run a task headlessly |
| `grove init` | Initialize grove in the current repo |
| `grove gc [--yes]` | Reclaim orphaned worktrees/compose projects |
| `grove doctor` | Check dependencies, credential, and the claude runtime |
| `grove install-runtime` | Fetch/verify the pinned native `claude` binary |
| `grove --version` | Print the version |

## Configuration

grove keeps its state under `~/.grove` (override with `GROVE_HOME`):

```
~/.grove/
  grove.db            # SQLite task store
  tasks/              # per-task worktrees + artifacts
  runtime/claude      # the fetched native claude binary
  config.json         # disk thresholds, agent model
```

Environment variables:

- `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` — the Anthropic credential
- `GROVE_HOME` — grove's home directory (default `~/.grove`)
- `GROVE_CLAUDE_PATH` — point grove at a specific `claude` binary (overrides the runtime dir + PATH)

## Development

Built with **Bun + TypeScript** (strict), compiled to a single binary with `bun build --compile`. The TUI uses **Ink** (React for the terminal). Every layer sits behind a swappable interface (`Store`, `AgentRunner`, `Router`, `TaskInfra`, `DiskMonitor`) so it's fully unit-testable with fakes — no network, Docker, or real agent in the suite.

```sh
bun install
bun test            # ~250 tests
bun run typecheck   # tsc --noEmit
bun run build       # dist/grove
bun run build:all   # cross-compile all 4 targets + SHASUMS256.txt
```

Releases are tag-driven: pushing a `v*` tag runs the release workflow, which cross-compiles the four binaries and publishes a GitHub Release (with `install.sh` + checksums).

## Status

**v1 (`v0.1.0`)** is complete: the free-text TUI, the headless runner, the checkpoint-gated task engine, worktree + Compose isolation, disk-aware `gc`, and the install/runtime tooling.

On the roadmap: a `debug` workflow (investigate → reproduce → fix → verify), an LLM-backed intent router, per-token live streaming, and Windows support.
