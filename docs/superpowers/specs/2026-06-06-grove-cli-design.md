# grove — AI Development Orchestration CLI — Design Spec

**Date:** 2026-06-06
**Status:** Approved (pending final spec review)
**Name:** `grove` (group of trees = isolated git worktrees)

## 1. Overview

`grove` is a standalone, cross-platform CLI that orchestrates AI-driven software
development inside isolated environments. A user installs it (`brew` / `curl`),
runs `init`, and lands in a **free-text prompt** (a Claude-Code-style REPL).
The user describes what they want in plain language — there is **no menu of
modes to pick from**. grove infers the right workflow ("superpowers-style") and
runs it.

- **Type prose to start work.** A fast **intent router** classifies the request
  as a `task` (build something) or a `debug` (investigate/fix a problem) and
  starts the matching checkpoint-gated workflow. The user never picks the kind;
  the detected kind is **confirmed at the first gate**, where it can be
  redirected if the router guessed wrong.
- **Commands/keys for navigation** (not prose): `/list` (or a hotkey) opens the
  task dashboard; `/open <id>` (or selecting from the list) jumps into a task.
  Keeping navigation as explicit commands means the router only ever has to
  classify *work* requests, never disambiguate work-vs-navigation.

Workflows:

- **task** — checkpoint-gated build flow:
  brainstorm → plan → execute → code review → finish branch.
- **debug** — investigation/reproduction-driven fix flow.
  *(Deferred to v1.1. In v1 a detected `debug` surfaces a "debugging coming in
  v1.1 — treat as a task?" note rather than running a debug flow.)*

The **list dashboard** (running / waiting for confirm / blocked / done /
stopped), reached via `/list`, tags each item with its router-detected kind.

Each task runs in an isolated environment built from three layers:

- **Worktree** = isolated code (git worktree + branch per task).
- **Docker Compose project** = isolated services (namespaced per task).
- **Devcontainer/sandbox** = isolated Claude execution. *(Deferred; designed-for.)*

The tool owns its agent loop via the **Claude Agent SDK**, with
superpowers-style workflow skills bundled into the binary.

## 2. Foundational Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Agent execution | **Own the agent via Claude Agent SDK** (TypeScript) | Programmatic control over each phase; reuse skill ecosystem by loading skills into the SDK agent. |
| Language/runtime | **TypeScript on Bun**, compiled to a single binary | Fast startup, cross-platform standalone binaries, self-contained (no Node prerequisite), native Agent SDK. |
| Distribution | **brew tap + `curl \| sh` installer** | One self-contained binary. Requires `git`, `docker`, `docker compose` present on host (checked by `doctor`). |
| UI | **Ink** (React-for-terminals) | Mature TUI; control plane over the engine. |
| Entry model | **Free-text prompt + intent router** (no mode menu) | User describes work in prose; a router classifies `task`/`debug` and runs the right workflow. Navigation stays as explicit `/list`/`/open` commands so the router only classifies work requests. Detected kind confirmed at the first gate. |
| Packaging | **Standalone app**, not a Claude Code plugin | Plugin can't host a top-level menu, a cross-task dashboard, many concurrent isolated environments, or become a GUI app / self-contained binary. |
| v1 isolation | **Worktree + Docker Compose per task** | Real code + service isolation; sandbox layer deferred but designed-for. |
| Human-in-loop | **Checkpoint-gated**: gates after brainstorm, after plan, before finish/merge | Predictable, trustworthy; matches `waiting_confirm` status. |
| Concurrency | **Hybrid: foreground/one-active-task in v1, daemon-ready engine** | Ship fast; clean engine/TUI split enables concurrent background daemon later without rewriting workflow logic. |

## 3. Architecture

Four independently-testable layers, each depending on **interfaces**, not
concrete implementations:

```
┌─────────────────────────────────────────────────┐
│  TUI (Ink) — free-text prompt, list dashboard,   │   control plane
│  gate prompts (/list, /open commands)            │
├─────────────────────────────────────────────────┤
│  Router — classifies a prose request →           │   intake
│  { kind: task|debug } (fast structured LLM call) │
├─────────────────────────────────────────────────┤
│  Task Engine — lifecycle state machine, gates    │   orchestration
├─────────────────────────────────────────────────┤
│  Agent Runtime — Claude Agent SDK session per    │   worker
│  phase, with bundled skills                      │
├─────────────────────────────────────────────────┤
│  Infra Layer — Worktree mgr + Compose mgr        │   isolation
│  (+ Sandbox mgr later) + DiskMonitor             │
└─────────────────────────────────────────────────┘
                     │
              Store (SQLite adapter)
```

The **Router** sits between the prompt and the engine: prose in, a structured
`{ kind, confidence, reasoning }` out. The engine then starts the workflow for
that kind. The router classifies *work requests only* — navigation is handled by
explicit commands in the TUI, never routed.

**Critical boundary:** the Task Engine exposes a clean async interface
(`startTask`, `advance`, `confirmGate`, `getStatus`, `subscribe(events)`) and
knows nothing about Ink. This is what lets v1 run in-process (foreground) and
later move behind a daemon (concurrent background) — the TUI subscribes
in-process now, over IPC later, with no UI rewrite.

**Layering / swappability discipline:** every layer boundary is an interface
(`Store`, `AgentRunner`, `WorktreeManager`, `ComposeManager`, `DiskMonitor`).
Concrete impls are adapters. Swapping SQLite for a stronger DB (Postgres/Turso)
= one new `Store` adapter + one wire-up line; zero changes to engine or TUI.

## 4. State Store & Lifecycle

### 4.1 Store interface (persistence abstraction)

The engine talks only to a `Store` interface
(`createTask`, `updateTask`, `queryTasks`, `appendEvent`, `updatePhaseRun`, …).
`SqliteStore` is the first adapter — a single file at `~/.grove/grove.db`
(driver bundled in the binary). SQLite chosen over flat JSON for queryable list
views and concurrent-ish status writes (future daemon writing while TUI reads).

### 4.2 Schema (logical)

- **`tasks`** — `id`, `title`, `kind` (`task`|`issue`), `status`,
  `current_phase`, `worktree_path`, `branch`, `compose_project`, `repo_path`,
  `created_at`, `updated_at`.
- **`phase_runs`** — `task_id`, `phase`, `state`, `started_at`, `ended_at`,
  `summary` (gate artifact, e.g. design/plan), `transcript_ref` (file path).
- **`events`** — append-only per-task log for live feed + audit:
  `task_id`, `ts`, `type`, `payload`.

Agent transcripts/logs are **files** under `~/.grove/tasks/<id>/`, referenced by
path (not blobbed into SQLite).

### 4.3 Lifecycle state machine

Phases (distinct from status):

```
brainstorm → plan → execute → review → finish
     │         │                          │
   [GATE]    [GATE]                     [GATE]
```

**Status** (what `list` shows):

- `running` — an agent phase is actively working.
- `waiting_confirm` — paused at a gate, needs approval.
- `blocked` — error / needs attention (compose failed, tests red, low disk).
- `done` — finished & merged.
- `stopped` — user-halted (**resumable** from last phase).

**Gate actions:** **approve** (advance), **request changes** (free-text feedback
re-runs the phase with that feedback as added context), **stop**.

`execute` and `review` auto-advance; gates only after brainstorm, after plan,
before finish. State is persisted to `Store` **after every transition**, so a
crash/quit resumes from the last good phase.

## 5. Infra / Isolation Layer

### 5.1 `WorktreeManager` — isolated code

- `create(taskId, repoPath)` → git worktree at
  `~/.grove/tasks/<id>/worktree` on branch `grove/<id>-<slug>`.
- `remove(taskId)`, `list()`, `getDiff(taskId)`.
- One task = one worktree = one branch. No task touches another's files or the
  user's main checkout.

### 5.2 `ComposeManager` — isolated services

- `up` / `down` / `status` / `logs` per task.
- Isolation via unique Compose **project name** per task (`grove-<id>`):
  containers, networks, volumes namespaced.
- **Port collision strategy:** do not hardcode host ports; rely on the Compose
  project network for inter-service comms; allocate host ports dynamically only
  when the user needs to reach a service, recording the mapping in task state.
- **No `docker-compose.yml` → skip the service layer** (worktree-only task; not
  an error).

### 5.3 `InfraManager` (facade)

- `provision(taskId)` = worktree create + compose up.
- `teardown(taskId)` = compose down + worktree remove.
- **Teardown on finish** (after confirmed merge). If merge fails, keep the env,
  go `blocked`.
- Orphan cleanup via `grove gc` (see §8).

Concrete impls shell out to `git` / `docker compose` through a small typed
wrapper, so logic is mockable without real git/docker.

## 6. Agent Runtime

### 6.0 Router (intake)

Before any workflow runs, the prose request goes through the **Router** — a
single fast, cheap **structured LLM call** (haiku-class) that returns
`{ kind: "task" | "debug", confidence, reasoning }`. It is *not* a full agent
loop; it is one classification call so the front door stays snappy.

- The router picks its **best guess** — no up-front clarifying question. The
  first-gate confirmation (§7) is the correction point, keeping intake instant.
- It classifies **work requests only**. Navigation (`/list`, `/open`) is handled
  by the TUI as explicit commands and never reaches the router.
- The chosen `kind` is written to `task.kind`; the engine selects the matching
  workflow definition. Behind an interface (`Router.classify(prompt)`) like every
  other boundary, so it's mockable and swappable.
- **v1:** only the `task` workflow is wired. A `debug` classification surfaces a
  "debugging coming in v1.1 — treat as a task?" prompt instead of running a debug
  flow.

### 6.1 One agent session per phase

Each phase is a bounded agent run: phase-specific system prompt, relevant skill
loaded, `cwd` = task worktree, defined completion artifact.

| Phase | Skill | Gate artifact |
|---|---|---|
| brainstorm | `brainstorming` | design doc → **GATE** |
| plan | `writing-plans` | implementation plan → **GATE** |
| execute | `executing-plans` | code changes + passing tests (auto-advance) |
| review | `requesting-code-review` | review report (auto-advance) |
| finish | `finishing-a-development-branch` | merge/PR → **GATE** |

Skills are **bundled with the binary** and pointed at via SDK config — the
methodology travels with the app, no external plugin install.

### 6.2 `AgentRunner` interface

`run(phase, context) → AsyncStream<AgentEvent>` plus a final
`PhaseResult { summary, artifactPath, success }`. SDK-backed impl is one
adapter (mockable; could later swap a headless-Claude adapter). Events stream
up → `events` table → TUI live feed (token output, tool calls, file edits).

### 6.3 Context handoff

The engine passes forward **artifacts** (design doc path, plan path) as context
between phases rather than replaying full transcripts — cheaper and cleaner.
Each phase reads prior artifacts from the worktree.

### 6.4 In-phase tool permissions (v1)

**Auto-approve tool use within the task scope.** Within a phase the agent runs
freely inside its worktree/compose env without per-tool prompts (matches
phase-level gating). v1 isolation is "worktree-scoped, host-executed"; **full
command isolation arrives with the sandbox layer** (roadmap). Documented
explicitly as a known v1 limitation.

## 7. TUI & UX (Ink)

### 7.1 Home — free-text prompt (REPL)

```
  grove

  › what do you want to work on?
  ▸ _

  /list  view tasks   ·   /open <id>  resume a task   ·   /help
  hint: run `grove doctor` to check your environment
```

The user types a request in prose and submits. There is **no mode menu**.
Commands (prefixed `/`) handle navigation; anything else is treated as a work
request and sent to the router.

### 7.2 Start-work flow

Submit prose → **Router** classifies `{ kind }` → engine creates the task
(`task.kind` = detected kind; provision worktree + compose) → attach to the live
agent feed for the first phase (`brainstorm` for a task).

**First-gate confirmation.** At the first gate the task view shows the artifact
**plus the detected kind**, e.g.:

```
  Detected: task  (router: "feature request — adds OAuth login")     [↹ change kind]

  <design doc preview …>

  [a]pprove   [r]equest changes   [c]hange kind   [s]top
```

`change kind` lets the user redirect if the router guessed wrong (e.g. reroute a
mis-detected task to the debug flow). Approve advances as normal.

### 7.3 List dashboard (`/list`)

Reached with the `/list` command (or a hotkey) from the home prompt — not a menu
item. Each row is tagged with its router-detected **KIND**.

```
  Tasks

  STATUS            KIND   TASK                       PHASE     UPDATED
  ● running         task   add OAuth login            execute   12s ago
  ⏸ waiting_confirm task   refactor billing module    plan      4m ago
  ⛔ blocked         debug  fix flaky checkout test     review    1h ago
  ✓ done            task   upgrade to React 19        finish    2d ago

  ↑↓ select · enter: open · s: stop · esc: back to prompt
```

Selecting a task (or `/open <id>` from the prompt) opens the **task view**: live
feed if running; gate artifact + actions if `waiting_confirm`; error + retry if
`blocked`.

### 7.4 Gate interaction

Task view shows the artifact (design/plan/diff) in a scrollable pane + action
bar. **Request changes** opens free-text input → re-runs the phase with that
feedback as added context.

### 7.5 Engine ↔ TUI binding

TUI subscribes to engine events (`engine.subscribe(taskId)`) and reads state via
`Store` queries. v1 feel: starting a task attaches you to its feed; `list` shows
other tasks' **saved** state (paused at gates, not progressing). True
simultaneous progress is the daemon upgrade — same TUI components, subscribe
over IPC instead of in-process.

## 8. Storage & Disk Management

Docker (images/containers/volumes/build cache) + worktrees can fill the host
disk; a full disk breaks Docker, git, and the agent mid-phase.

### 8.1 `DiskMonitor` (read-only/advisory component)

- Reports free space on the volume backing `~/.grove` and Docker's data root,
  plus **grove-owned** usage (worktree sizes + `grove-<id>` volumes/images).
- Surfaced in `grove doctor` and as a **TUI footer indicator** (amber/red under
  thresholds).

### 8.2 Guardrails (preflight, before provisioning)

- Before `provision(taskId)`, check free space against thresholds
  (**warn < 10 GB, block < 2 GB**, configurable in `~/.grove/config`).
- Below block threshold → task goes `blocked` **before** spending anything, with
  a clear message pointing to `grove gc`. Never fail deep in a phase due to disk.

### 8.3 Reclamation

- **Teardown on finish** returns the biggest chunks (compose volumes/images +
  worktree).
- **`grove gc`** reclaims **grove-owned resources only**: orphaned worktrees from
  crashed tasks, dangling `grove-<id>` images/volumes/networks, grove-attributable
  build cache. **Safety rule (explicit):** `grove gc` filters strictly on the
  `grove-` project prefix / labels and **never** runs a blanket
  `docker system prune` — it never touches the user's unrelated Docker
  resources.
- Per-task/global disk **quota** that pauses new provisioning — design-for-later.

### 8.4 Boundary

`DiskMonitor` is advisory; reclamation lives in `InfraManager` (owns lifecycle).
The engine consults `DiskMonitor` at provisioning gates.

## 9. Error Handling

- **Preflight (`doctor`/`init`):** detect missing/old `git`/`docker`/
  `docker compose` up front with actionable messages.
- **Phase failures:** API failure / tests red / build broken → task `blocked`,
  error captured in `events`; task view offers retry / request-changes / stop.
- **Infra failures:** `compose up` failure → `blocked` before the agent starts;
  port conflicts surface as a named error with the conflicting port.
- **Crash safety:** every transition persists to `Store` first → resume from
  last good phase. Orphans reclaimable via `grove gc`.
- **Teardown safety:** finish-teardown only after a confirmed merge.

## 10. Testing Strategy

- **Unit:** engine state machine with mocked `Store`, `AgentRunner`,
  `InfraManager`, `DiskMonitor` — full lifecycle (gates, request-changes, stop,
  resume, blocked) with zero git/docker/API.
- **Adapter tests:** `SqliteStore` against a temp DB; `WorktreeManager` /
  `ComposeManager` against the typed git/docker wrapper (mocked for logic + a
  small set of real-git/real-docker integration tests behind a flag).
- **Router:** `Router.classify` tested with a mocked LLM call — prose fixtures
  asserting `task` vs `debug` classification, plus low-confidence handling.
- **TUI:** `ink-testing-library` for the free-text prompt, `/list`/`/open`
  command handling, list rendering, first-gate kind-confirmation, and gate
  actions, driven by a fake engine + fake router.
- **E2E smoke:** one real "start task → gate → approve → finish" run against a
  tiny throwaway repo, in CI with Docker available.

TDD throughout (failing test first), per the methodology the tool embodies.

## 11. v1 Scope Boundary

| In v1 | Deferred (designed-for) |
|---|---|
| `init` + `doctor` preflight | Agent-in-sandbox execution |
| **Free-text prompt + Router** (classifies kind) | Concurrent background daemon |
| **task** workflow w/ 3 gates + first-gate kind confirmation | GUI app |
| `/list` dashboard (live/saved status, KIND column) | Per-phase auto/gate policy config |
| `/open <id>` to resume a task | Multi-provider / model-agnostic |
| Worktree + Compose isolation per task | Stronger-DB adapter (Postgres/Turso) |
| Own-agent loop via Agent SDK + bundled skills | Disk quotas |
| `Store` (SQLite adapter) | **debug** workflow (v1.1; v1 shows "treat as task?") |
| `DiskMonitor` + guardrails + `grove gc` | |
| Teardown on finish | |

## 12. Open Questions / Future

- Sandbox/devcontainer layer: how the Agent SDK runs *inside* a container with
  UI streamed back out (the hardest deferred piece).
- Daemon + IPC protocol for concurrent background tasks.
- Debug-issue workflow definition (v1.1) — plugs into the same engine.
- GUI app shell reusing the engine + `Store` over IPC/HTTP.
