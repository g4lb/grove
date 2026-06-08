<div align="center">

# grove

**Hand a task to an AI agent and get a committed branch back — built autonomously in its own isolated git worktree + Docker environment, driven by the [obra/superpowers](https://github.com/obra/superpowers) methodology.**

[![release](https://img.shields.io/github/v/release/g4lb/grove?sort=semver)](https://github.com/g4lb/grove/releases)
[![ci](https://github.com/g4lb/grove/actions/workflows/ci.yml/badge.svg)](https://github.com/g4lb/grove/actions/workflows/ci.yml)
![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue)

</div>

grove is a terminal-native CLI that turns a plain-English request into an autonomous build run by the Claude agent. You describe what you want; grove provisions a throwaway worktree, hands the task to one agent session running the superpowers skills — which brainstorms, plans, implements test-first, reviews, and commits on its own — then leaves you a branch to review. Your main branch is never touched.

- **Isolated** — every task gets its own git worktree and Docker Compose project; nothing leaks into your working tree, and `grove gc` reclaims the leftovers.
- **Autonomous** — one agent session takes the task from idea to a committed change using the `obra/superpowers` methodology (brainstorm → plan → TDD → review → commit). No phases to babysit, no gates to click through.
- **Verified done** — grove only reports `done` once real commits land on the task branch; a session that finishes without committing is `blocked`, with its worktree left in place for you to inspect.
- **Bring your own Claude** — reuses your existing Claude Code login and `claude` binary; the superpowers skills are reused from your install or fetched once. No extra keys, no redundant downloads.

## Install

```sh
curl -fsSL https://github.com/g4lb/grove/releases/latest/download/install.sh | sh
```

or with Homebrew:

```sh
brew install g4lb/tap/grove
```

The installer fetches the binary for your platform, verifies its checksum, adds grove to your `PATH`, and sets up the `claude` runtime — reusing your existing one if you already have Claude Code. macOS and Linux, arm64 and x64.

## Usage

Launch the TUI and describe a task:

```sh
grove
```

```
› add a /health endpoint that returns 200
  · session started
  · Write  · Edit  · Bash
  done — branch grove/health-endpoint is ready
```

grove streams the agent's live progress, then hands you the finished branch. Type `/list` for the task dashboard and `/open <id>` to revisit one.

Or run it headlessly:

```sh
grove run "fix the flaky logout test"
```

Other commands:

```sh
grove doctor            # check git, docker, your credential, and the claude runtime
grove gc                # reclaim worktrees + compose projects from finished tasks
grove install-runtime   # (re)install the pinned claude binary
```

## Authentication

grove drives the Claude agent, so it needs an Anthropic credential. The simplest path: be logged into **Claude Code** (`claude login` opens the browser once) — grove detects that login automatically, no environment variables required. Alternatively, set `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. Run `grove doctor` to confirm.

## How it works

A task is one autonomous agent session, bracketed by grove's isolation:

```
provision ─▸ autonomous superpowers session ─▸ done (committed) │ blocked ─▸ teardown
```

1. **Provision** — grove creates a git worktree (branch `grove/<task>`) and a Docker Compose project for the task, isolated from everything else.
2. **Run** — grove loads the `obra/superpowers` plugin into one Claude session (resolving it from your Claude Code install, or fetching the pinned version into `~/.grove/plugins` the first time) and hands it the task. The agent applies the methodology — brainstorm the approach, write a plan, implement it test-first, review, and commit — fully autonomously, while grove streams its progress.
3. **Verify** — when the session ends, grove checks the task branch for commits. Commits landed → `done`, branch ready for review, environment torn down. Nothing committed (or an error) → `blocked`, worktree preserved so you can look.
4. **Recover** — every transition is persisted before it returns and runs crash-safe, so a failed provision, agent error, or teardown failure can never strand a task; `grove gc` cleans up anything orphaned.

The engine sits behind swappable interfaces (store, agent, infra), so the TUI and the headless runner are just two clients of the same core.

## Configuration

grove keeps its state under `~/.grove` (override with `GROVE_HOME`):

```
~/.grove/
  grove.db            # SQLite task store
  tasks/              # per-task worktrees
  plugins/superpowers # the superpowers skills (when grove fetches its own copy)
  runtime/claude      # the native claude binary
  config.json         # disk thresholds, agent model
```

- `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` — an Anthropic credential (or just log into Claude Code).
- `GROVE_CLAUDE_PATH` — point grove at a specific `claude` binary.
- `GROVE_SUPERPOWERS_PATH` — point grove at a specific superpowers plugin directory.
- `GROVE_HOME` — grove's home directory.

## Building

grove is Bun + TypeScript, compiled to a single binary; the TUI is Ink (React for the terminal). Every layer is behind an interface, so the test suite runs entirely with fakes — no network, Docker, or live agent.

```sh
bun install
bun test            # ~250 tests
bun run typecheck
bun run build       # → dist/grove
bun run build:all   # cross-compile all four targets + checksums
```

Releases are cut by pushing a `v*` tag, which builds the four binaries and publishes a GitHub Release.

## Status

`v0.2` replaces grove's earlier gated five-phase workflow with a single autonomous session driven by `obra/superpowers` — keeping the worktree + Compose isolation, the crash-safe engine, and the install tooling. Next: a turn/cost budget, an operator escape hatch for stuck tasks, and Windows support.
