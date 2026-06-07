<div align="center">

# grove

**Hand a task to an AI agent and get working code back — each task built in its own isolated git worktree + Docker environment, with a human checkpoint at every step.**

[![release](https://img.shields.io/github/v/release/g4lb/grove?sort=semver)](https://github.com/g4lb/grove/releases)
[![ci](https://github.com/g4lb/grove/actions/workflows/ci.yml/badge.svg)](https://github.com/g4lb/grove/actions/workflows/ci.yml)
![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue)

</div>

grove is a terminal-native CLI that turns a plain-English request into a gated build workflow run by the Claude agent. You describe what you want; grove plans it, writes it, and reviews it — pausing for your approval at each checkpoint — all inside a throwaway worktree so your main branch is never touched.

- **Isolated** — every task gets its own git worktree and Docker Compose project; nothing leaks into your working tree, and `grove gc` reclaims the leftovers.
- **Gated** — the agent stops after brainstorm, after the plan, and before finishing, so you approve, request changes, or stop. No surprise commits.
- **Two ways in** — an interactive TUI and a headless `grove run` (for scripts and CI), both over the same crash-safe engine.
- **Bring your own Claude** — reuses your existing Claude Code login and `claude` binary; no extra keys, no redundant downloads.

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
  detected: task
  · Write  · Edit
  gate — plan done
  [a]pprove / [r]equest changes / [s]top
```

Approve (`a`), send it back with feedback (`r`), or stop (`s`) at each gate. Type `/list` for the task dashboard and `/open <id>` to revisit one.

Or run it headlessly:

```sh
grove run "fix the flaky logout test"          # interactive gates on stdin
grove run "fix the flaky logout test" --yes    # auto-approve every gate
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

Each task moves through five phases, with your sign-off at three gates:

```
brainstorm ─▸│gate│─▸ plan ─▸│gate│─▸ execute ─▸ review ─▸│gate│─▸ finish
```

1. **Provision** — grove creates a git worktree (branch `grove/<task>`) and a Docker Compose project for the task, isolated from everything else.
2. **Brainstorm** — the agent explores the request and writes a short design; grove pauses for your approval.
3. **Plan** — it turns the design into a step-by-step implementation plan; you approve it or send it back.
4. **Execute & review** — it implements the plan, then reviews its own diff.
5. **Finish** — after your final approval, grove wraps up and tears the environment down.
6. **Recover** — every transition is persisted before it returns, so a crashed or stopped task can be resumed, and `grove gc` cleans up anything orphaned.

The engine sits behind swappable interfaces (store, agent, router, infra), so the TUI and the headless runner are just two clients of the same core.

## Configuration

grove keeps its state under `~/.grove` (override with `GROVE_HOME`):

```
~/.grove/
  grove.db          # SQLite task store
  tasks/            # per-task worktrees + artifacts
  runtime/claude    # the native claude binary
  config.json       # disk thresholds, agent model
```

- `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` — an Anthropic credential (or just log into Claude Code).
- `GROVE_CLAUDE_PATH` — point grove at a specific `claude` binary.
- `GROVE_HOME` — grove's home directory.

## Building

grove is Bun + TypeScript, compiled to a single binary; the TUI is Ink (React for the terminal). Every layer is behind an interface, so the test suite runs entirely with fakes — no network, Docker, or live agent.

```sh
bun install
bun test            # ~260 tests
bun run typecheck
bun run build       # → dist/grove
bun run build:all   # cross-compile all four targets + checksums
```

Releases are cut by pushing a `v*` tag, which builds the four binaries and publishes a GitHub Release.

## Status

`v0.1.x` ships the full build workflow, the TUI and headless runner, worktree + Compose isolation, and the install tooling. Next: a debug workflow (investigate → reproduce → fix → verify), an LLM-backed intent router, and Windows support.
