# grove — Plan 4b: Router, Real Wiring & `grove run` Driver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make grove runnable end-to-end — a heuristic `Router` (prose → task/debug), a headless `grove run "<prose>"` driver that wires the real `InfraManager` + `SdkAgentRunner` + `DiskMonitor` into the `TaskEngine`, disk-gates and prechecks before provisioning, streams the agent feed, and drives a task through its gates via interactive stdin (or `--yes`).

**Architecture:** Mirrors the rest of grove — `Router` is an interface (`HeuristicRouter` now, an LLM adapter later). The driver's `runTask` takes injected deps (a narrow `RunEngine`, `Router`, `DiskMonitor`, an injectable gate-decider, an `out` writer) so it's fully unit-testable with fakes — no API/Docker/stdin. The `TaskEngine` already accepts the real `InfraManager`/`SdkAgentRunner` via its interfaces; the CLI `run` case is the composition root that builds them.

**Tech Stack:** Bun (`bun test`, `prompt()` for stdin), TypeScript (strict). Plan 1–4a modules: `Store`/`SqliteStore`, `TaskEngine`, `InfraManager`(`GitWorktreeManager`+`DockerComposeManager`), `SdkAgentRunner`, `ShellDiskMonitor`, `detectCredentials`, `loadConfig`, `phaseDefinition`, domain types.

---

## Context for the implementer (read once)

Plans 1–4a are merged on `main`. Relevant existing code:
- `src/engine/task-engine.ts` — `TaskEngine({store, agent, infra, model, now?})`: `startTask(input)`, `confirmGate(taskId, decision)`, `resume`, `getStatus`, `getEvents`, `subscribe(taskId, handler): ()=>void`. `StartTaskInput {title, description?, repoPath, kind}`, `GateDecision = {kind:"approve"} | {kind:"rerun";feedback?} | {kind:"stop"}`.
- `src/engine/task-infra.ts` — `TaskInfra` (the real `InfraManager` satisfies it).
- `src/infra/infra-manager.ts` — `InfraManager(worktrees, compose)`; `src/infra/worktree-manager.ts` — `GitWorktreeManager(git, paths)`; `src/infra/git-runner.ts` — `GitRunner(runner, repoPath)` with `isGitRepo()`; `src/infra/docker-runner.ts` — `DockerRunner(runner)`; `src/infra/compose-manager.ts` — `DockerComposeManager(docker)`.
- `src/infra/disk-monitor.ts` — `ShellDiskMonitor(runner)`: `freeBytes(path)`, `evaluate(free, {warnBytes,blockBytes}): "ok"|"warn"|"block"`, `DiskMonitor`, `DiskThresholds`, `DiskVerdict`.
- `src/agent/sdk-agent-runner.ts` — `SdkAgentRunner({queryFn?, env?})`.
- `src/agent/credentials.ts` — `detectCredentials(env)`, `hasCredentials(env)`.
- `src/agent/phases.ts` — `phaseDefinition(phase): {systemPromptAppend, artifactRelPath: string|null, maxTurns}`.
- `src/config/config.ts` — `loadConfig(paths)` → `{disk:{warnBytes,blockBytes}, agent:{model}}`.
- `src/config/paths.ts` — `resolvePaths(root?)` → `GrovePaths`.
- `src/infra/command-runner.ts` — `BunCommandRunner`.
- `src/cli/index.ts` — dispatch for `--version`/`init`/`doctor`/`gc`, with a `grovePaths()` helper (honors `GROVE_HOME`).
- `src/domain/types.ts` — `Task` (now incl. `description: string|null`), `TaskKind = "task"|"issue"`, `TaskStatus`, `Phase`. `src/agent/events.ts` — `AgentEvent`.

**Environment quirk:** bun is at `~/.bun/bin/bun`, NOT on PATH. Prepend `export PATH="$HOME/.bun/bin:$PATH";` to every bun command. Verify: `export PATH="$HOME/.bun/bin:$PATH"; bun --version` → `1.3.14`. Imports use explicit `.ts` extensions. TDD throughout. One logical change per commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/router.ts` | `Router` interface + `RouterResult` + `HeuristicRouter` |
| `src/engine/task-engine.ts` | (modify) guard `confirmGate` against a `done` task |
| `src/cli/gate-prompt.ts` | `stdinGateDecider(readLine)` — parse a/r/s[+feedback] |
| `src/cli/run-driver.ts` | `runTask(prose, deps)` — the headless driver |
| `src/cli/index.ts` | (modify) add the `run` subcommand (composition root) |
| `test/engine/*`, `test/cli/*` | one test file per module |

---

## Task 1: Heuristic Router

**Files:**
- Create: `src/engine/router.ts`
- Test: `test/engine/router.test.ts`

- [ ] **Step 1: Write the failing test**

`test/engine/router.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { HeuristicRouter } from "../../src/engine/router.ts";

test("classifies bug-fix prose as debug", async () => {
  const r = new HeuristicRouter();
  const out = await r.classify("the login page is broken and throws an error");
  expect(out.kind).toBe("debug");
  expect(out.confidence).toBeGreaterThan(0.5);
  expect(out.reasoning.length).toBeGreaterThan(0);
});

test("classifies build prose as task", async () => {
  const r = new HeuristicRouter();
  const out = await r.classify("add a settings page with a dark mode toggle");
  expect(out.kind).toBe("task");
});

test("matches debug signals case-insensitively and as whole-ish words", async () => {
  const r = new HeuristicRouter();
  expect((await r.classify("FIX the crash on startup")).kind).toBe("debug");
  expect((await r.classify("Add a feature")).kind).toBe("task");
});

test("confidence stays within [0,1]", async () => {
  const r = new HeuristicRouter();
  const out = await r.classify("fix bug error crash broken failing regression");
  expect(out.confidence).toBeLessThanOrEqual(1);
  expect(out.confidence).toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/engine/router.test.ts`
Expected: FAIL — "Cannot find module '../../src/engine/router.ts'".

- [ ] **Step 3: Write the implementation**

`src/engine/router.ts`:
```typescript
export type RouterKind = "task" | "debug";

export interface RouterResult {
  kind: RouterKind;
  confidence: number;
  reasoning: string;
}

/** Classifies a free-text request into a workflow kind. Async so an LLM adapter can drop in later. */
export interface Router {
  classify(prose: string): Promise<RouterResult>;
}

// Signal words that indicate an investigation/fix (debug) rather than a build (task).
const DEBUG_SIGNALS = [
  "fix",
  "bug",
  "broken",
  "crash",
  "error",
  "failing",
  "fails",
  "regression",
  "debug",
  "exception",
  "stack trace",
  "not working",
  "doesn't work",
];

/** A cheap, instant, dependency-free router. The LLM-backed adapter arrives with the v1.1 debug workflow. */
export class HeuristicRouter implements Router {
  async classify(prose: string): Promise<RouterResult> {
    const lower = prose.toLowerCase();
    const hits = DEBUG_SIGNALS.filter((s) => lower.includes(s));
    if (hits.length > 0) {
      return {
        kind: "debug",
        confidence: Math.min(1, 0.5 + 0.1 * hits.length),
        reasoning: `matched debug signal(s): ${hits.join(", ")}`,
      };
    }
    return { kind: "task", confidence: 0.6, reasoning: "no debug signals — treating as a build task" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/engine/router.test.ts`
Expected: PASS — 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/router.ts test/engine/router.test.ts
git commit -m "feat: add heuristic Router (prose -> task/debug)"
```

---

## Task 2: Guard `confirmGate` against a `done` task

**Files:**
- Modify: `src/engine/task-engine.ts`
- Test: `test/engine/confirm-done-guard.test.ts`

A `done` task accepts no gate decisions (a `rerun` would re-run `finish` + double-teardown; a `stop` would overwrite `done`). This is the Plan 4a carry-forward.

- [ ] **Step 1: Write the failing test**

`test/engine/confirm-done-guard.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { buildEngine, ok } from "./helpers.ts";

function fullScripts() {
  return {
    brainstorm: ok("brainstorm", "/wt/.grove/design.md"),
    plan: ok("plan", "/wt/.grove/plan.md"),
    execute: ok("execute", null),
    review: ok("review", "/wt/.grove/review.md"),
    finish: ok("finish", null),
  };
}

async function toDone() {
  const { engine } = buildEngine(fullScripts());
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  await engine.confirmGate(t0.id, { kind: "approve" });
  await engine.confirmGate(t0.id, { kind: "approve" });
  await engine.confirmGate(t0.id, { kind: "approve" }); // done
  return { engine, id: t0.id };
}

test("rerun on a done task throws (no re-running finish / double teardown)", async () => {
  const { engine, id } = await toDone();
  await expect(engine.confirmGate(id, { kind: "rerun" })).rejects.toThrow();
});

test("stop on a done task throws (does not overwrite done)", async () => {
  const { engine, id } = await toDone();
  await expect(engine.confirmGate(id, { kind: "stop" })).rejects.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/engine/confirm-done-guard.test.ts`
Expected: FAIL — `rerun`/`stop` on a done task currently succeed (no throw).

- [ ] **Step 3: Edit `src/engine/task-engine.ts`**

In `confirmGate`, add a guard at the very top of the method (right after `const task = this.requireTask(taskId);`):
```typescript
  async confirmGate(taskId: string, decision: GateDecision): Promise<Task> {
    const task = this.requireTask(taskId);

    if (task.status === "done") {
      throw new Error(`cannot ${decision.kind} a completed task ${taskId}`);
    }

    if (decision.kind === "stop") {
```
(keep the rest of the method unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/engine/confirm-done-guard.test.ts test/engine/confirm-approve.test.ts`
Expected: PASS — the 2 new tests + the existing confirm-approve tests (the "approve after done throws" case still throws, now via the done guard).

- [ ] **Step 5: Commit**

```bash
git add src/engine/task-engine.ts test/engine/confirm-done-guard.test.ts
git commit -m "fix: confirmGate rejects decisions on a completed task"
```

---

## Task 3: `runTask` driver core

**Files:**
- Create: `src/cli/run-driver.ts`
- Test: `test/cli/run-driver.test.ts`

`runTask` prechecks (credential + git repo), disk-gates, classifies, starts the task, and drives the gate loop with an injected decider. Fully unit-testable with fakes.

- [ ] **Step 1: Write the failing test**

`test/cli/run-driver.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { runTask, type RunDeps, type RunEngine } from "../../src/cli/run-driver.ts";
import { HeuristicRouter } from "../../src/engine/router.ts";
import { resolvePaths } from "../../src/config/paths.ts";
import type { Task } from "../../src/domain/types.ts";
import type { GateDecision } from "../../src/engine/task-engine.ts";

function task(over: Partial<Task>): Task {
  return {
    id: "task_1",
    title: "x",
    description: null,
    kind: "task",
    status: "waiting_confirm",
    currentPhase: "brainstorm",
    repoPath: "/repo",
    worktreePath: "/wt",
    branch: "grove/task_1",
    composeProject: null,
    createdAt: "t",
    updatedAt: "t",
    ...over,
  };
}

// A scripted engine: startTask returns the first state, confirmGate walks a queue.
function fakeEngine(states: Task[]): RunEngine {
  let i = 0;
  return {
    async startTask() {
      return states[i++]!;
    },
    async confirmGate(_id, _d: GateDecision) {
      return states[i++]!;
    },
    subscribe() {
      return () => {};
    },
  };
}

function deps(over: Partial<RunDeps>): RunDeps {
  return {
    engine: fakeEngine([task({ status: "done", currentPhase: "finish" })]),
    router: new HeuristicRouter(),
    disk: { async freeBytes() { return 100 * 1024 ** 3; }, evaluate() { return "ok"; } },
    thresholds: { warnBytes: 10, blockBytes: 2 },
    paths: resolvePaths("/groveroot"),
    repoPath: "/repo",
    hasCredential: true,
    isGitRepo: true,
    yes: true,
    decide: async () => ({ kind: "approve" }),
    out: () => {},
    ...over,
  };
}

test("fails fast with no credential (never provisions)", async () => {
  let started = false;
  const e: RunEngine = { async startTask() { started = true; return task({}); }, async confirmGate() { return task({}); }, subscribe() { return () => {}; } };
  const res = await runTask("add a page", deps({ hasCredential: false, engine: e }));
  expect(res.ok).toBe(false);
  expect(res.message.toLowerCase()).toContain("credential");
  expect(started).toBe(false);
});

test("fails fast when cwd is not a git repo", async () => {
  const res = await runTask("add a page", deps({ isGitRepo: false }));
  expect(res.ok).toBe(false);
  expect(res.message.toLowerCase()).toContain("git");
});

test("blocks when disk is below the block threshold", async () => {
  const res = await runTask("add a page", deps({ disk: { async freeBytes() { return 1; }, evaluate() { return "block"; } } }));
  expect(res.ok).toBe(false);
  expect(res.message.toLowerCase()).toContain("disk");
});

test("with --yes, drives the task to done", async () => {
  const out: string[] = [];
  const res = await runTask("add a settings page", deps({
    engine: fakeEngine([
      task({ status: "waiting_confirm", currentPhase: "brainstorm" }),
      task({ status: "waiting_confirm", currentPhase: "plan" }),
      task({ status: "waiting_confirm", currentPhase: "review" }),
      task({ status: "done", currentPhase: "finish" }),
    ]),
    yes: true,
    out: (l) => out.push(l),
  }));
  expect(res.ok).toBe(true);
  expect(res.status).toBe("done");
});

test("uses the injected decider when not --yes (and stop ends the run)", async () => {
  const res = await runTask("add a page", deps({
    engine: fakeEngine([
      task({ status: "waiting_confirm", currentPhase: "brainstorm" }),
      task({ status: "stopped", currentPhase: "brainstorm" }),
    ]),
    yes: false,
    decide: async () => ({ kind: "stop" }),
  }));
  expect(res.status).toBe("stopped");
});

test("a debug-classified request is noted and still runs (v1.1 note)", async () => {
  const out: string[] = [];
  await runTask("fix the broken login", deps({
    engine: fakeEngine([task({ status: "done", currentPhase: "finish", kind: "issue" })]),
    out: (l) => out.push(l),
  }));
  expect(out.join("\n").toLowerCase()).toContain("debug");
  expect(out.join("\n").toLowerCase()).toContain("v1.1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/run-driver.test.ts`
Expected: FAIL — "Cannot find module '../../src/cli/run-driver.ts'".

- [ ] **Step 3: Write the implementation**

`src/cli/run-driver.ts`:
```typescript
import { join } from "node:path";
import type { Task, TaskKind } from "../domain/types.ts";
import type { AgentEvent } from "../agent/events.ts";
import type { StartTaskInput, GateDecision } from "../engine/task-engine.ts";
import type { Router } from "../engine/router.ts";
import type { DiskMonitor, DiskThresholds } from "../infra/disk-monitor.ts";
import type { GrovePaths } from "../config/paths.ts";
import { phaseDefinition } from "../agent/phases.ts";

/** The narrow engine surface the driver needs (the real TaskEngine satisfies it). */
export interface RunEngine {
  startTask(input: StartTaskInput): Promise<Task>;
  confirmGate(taskId: string, decision: GateDecision): Promise<Task>;
  subscribe(taskId: string, handler: (event: AgentEvent) => void): () => void;
}

export interface RunDeps {
  engine: RunEngine;
  router: Router;
  disk: Pick<DiskMonitor, "freeBytes" | "evaluate">;
  thresholds: DiskThresholds;
  paths: GrovePaths;
  repoPath: string;
  hasCredential: boolean;
  isGitRepo: boolean;
  yes: boolean;
  decide: (gate: { task: Task; artifactPath: string | null }) => Promise<GateDecision>;
  out: (line: string) => void;
}

export interface RunResult {
  ok: boolean;
  taskId?: string;
  status?: string;
  message: string;
}

/** Absolute path of the gate artifact for a task's current phase, or null. */
function artifactFor(task: Task): string | null {
  if (!task.worktreePath) return null;
  const rel = phaseDefinition(task.currentPhase).artifactRelPath;
  return rel ? join(task.worktreePath, rel) : null;
}

export async function runTask(prose: string, deps: RunDeps): Promise<RunResult> {
  // 1. Prechecks — fail before provisioning.
  if (!deps.hasCredential) {
    return { ok: false, message: "no Anthropic credential — set ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN)" };
  }
  if (!deps.isGitRepo) {
    return { ok: false, message: "not a git repository — run grove from inside your project" };
  }

  // 2. Disk gate.
  const free = await deps.disk.freeBytes(deps.paths.root);
  const verdict = deps.disk.evaluate(free, deps.thresholds);
  if (verdict === "block") {
    return { ok: false, message: "not enough free disk space to provision — reclaim space with `grove gc`" };
  }
  if (verdict === "warn") {
    deps.out("⚠ low disk space — proceeding, but consider `grove gc`");
  }

  // 3. Classify.
  const routed = await deps.router.classify(prose);
  deps.out(`detected: ${routed.kind} (${routed.reasoning})`);
  const kind: TaskKind = routed.kind === "debug" ? "issue" : "task";
  if (routed.kind === "debug") {
    deps.out("debugging is coming in v1.1 — running this as a task for now");
  }

  // 4. Start + drive gates.
  let task = await deps.engine.startTask({ title: prose, repoPath: deps.repoPath, kind });
  const off = deps.engine.subscribe(task.id, (event) => {
    if (event.type === "tool_use") deps.out(`  · ${event.tool}`);
    else if (event.type === "notice") deps.out(`  · ${event.message}`);
  });
  try {
    deps.out(`phase ${task.currentPhase}: ${task.status}`);
    while (task.status === "waiting_confirm") {
      const artifactPath = artifactFor(task);
      deps.out(`gate — ${task.currentPhase} done${artifactPath ? ` (see ${artifactPath})` : ""}`);
      const decision: GateDecision = deps.yes ? { kind: "approve" } : await deps.decide({ task, artifactPath });
      task = await deps.engine.confirmGate(task.id, decision);
      deps.out(`phase ${task.currentPhase}: ${task.status}`);
      if (decision.kind === "stop") break;
    }
  } finally {
    off();
  }

  // 5. Terminal.
  if (task.status === "done") return { ok: true, taskId: task.id, status: "done", message: "task complete" };
  if (task.status === "blocked") return { ok: false, taskId: task.id, status: "blocked", message: `blocked at ${task.currentPhase}` };
  if (task.status === "stopped") return { ok: true, taskId: task.id, status: "stopped", message: `stopped at ${task.currentPhase}` };
  return { ok: true, taskId: task.id, status: task.status, message: task.status };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/run-driver.test.ts`
Expected: PASS — 6 pass.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck`
Expected: all pass; `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/cli/run-driver.ts test/cli/run-driver.test.ts
git commit -m "feat: add headless runTask driver (precheck, disk-gate, classify, gate loop)"
```

---

## Task 4: stdin gate-decider

**Files:**
- Create: `src/cli/gate-prompt.ts`
- Test: `test/cli/gate-prompt.test.ts`

Parses an interactive gate answer. Takes a `readLine` function so it's testable without real stdin.

- [ ] **Step 1: Write the failing test**

`test/cli/gate-prompt.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { stdinGateDecider } from "../../src/cli/gate-prompt.ts";

/** A scripted readLine that returns queued answers in order. */
function scripted(answers: string[]) {
  let i = 0;
  return async (_prompt: string) => answers[i++] ?? "";
}

test("'a' approves", async () => {
  expect(await stdinGateDecider(scripted(["a"]))).toEqual({ kind: "approve" });
});

test("'s' stops", async () => {
  expect(await stdinGateDecider(scripted(["s"]))).toEqual({ kind: "stop" });
});

test("'r' then feedback re-runs with that feedback", async () => {
  expect(await stdinGateDecider(scripted(["r", "use OAuth, not passwords"]))).toEqual({
    kind: "rerun",
    feedback: "use OAuth, not passwords",
  });
});

test("answers are case-insensitive and trimmed", async () => {
  expect(await stdinGateDecider(scripted(["  A  "]))).toEqual({ kind: "approve" });
});

test("an empty/unknown answer defaults to stop (safe)", async () => {
  expect(await stdinGateDecider(scripted([""]))).toEqual({ kind: "stop" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/gate-prompt.test.ts`
Expected: FAIL — "Cannot find module '../../src/cli/gate-prompt.ts'".

- [ ] **Step 3: Write the implementation**

`src/cli/gate-prompt.ts`:
```typescript
import type { GateDecision } from "../engine/task-engine.ts";

export type ReadLine = (prompt: string) => Promise<string>;

/** Prompt for a gate decision. `[a]pprove / [r]equest changes / [s]top`. Defaults to stop on anything else. */
export async function stdinGateDecider(readLine: ReadLine): Promise<GateDecision> {
  const ans = (await readLine("[a]pprove / [r]equest changes / [s]top: ")).trim().toLowerCase();
  if (ans === "a" || ans === "approve") return { kind: "approve" };
  if (ans === "r" || ans === "request" || ans === "request changes") {
    const feedback = (await readLine("describe the changes: ")).trim();
    return { kind: "rerun", feedback: feedback.length > 0 ? feedback : undefined };
  }
  // "s"/"stop"/empty/unknown → stop (safe default; never silently approves).
  return { kind: "stop" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/gate-prompt.test.ts`
Expected: PASS — 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/gate-prompt.ts test/cli/gate-prompt.test.ts
git commit -m "feat: add stdin gate-decider"
```

---

## Task 5: Wire `grove run` into the CLI

**Files:**
- Modify: `src/cli/index.ts`
- Test: `test/cli/index.run.test.ts`

The composition root: builds the real engine + deps and calls `runTask`. The test exercises the **credential-missing fast-exit** path (no API/Docker/stdin).

- [ ] **Step 1: Write the failing test**

`test/cli/index.run.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "..", "..", "src", "cli", "index.ts");

async function runCli(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn(["bun", ENTRY, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

test("grove run with no Anthropic credential fails fast with a clear message", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  mkdirSync(join(root, "tasks"), { recursive: true });
  try {
    // Explicitly clear both credential vars for this run.
    const { code, stdout } = await runCli(["run", "add a page"], {
      GROVE_HOME: root,
      ANTHROPIC_API_KEY: "",
      CLAUDE_CODE_OAUTH_TOKEN: "",
    });
    expect(code).toBe(1);
    expect(stdout.toLowerCase()).toContain("credential");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("grove run with no prose prints usage", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  try {
    const { code, stdout } = await runCli(["run"], { GROVE_HOME: root, ANTHROPIC_API_KEY: "" });
    expect([0, 1]).toContain(code);
    expect(stdout.toLowerCase()).toContain("usage");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/index.run.test.ts`
Expected: FAIL — `run` is unknown so it prints usage; the credential assertion fails.

- [ ] **Step 3: Update `src/cli/index.ts`**

Add these imports below the existing imports:
```typescript
import { mkdirSync } from "node:fs";
import { loadConfig } from "../config/config.ts";
import { GitWorktreeManager } from "../infra/worktree-manager.ts";
import { DockerComposeManager } from "../infra/compose-manager.ts";
import { InfraManager } from "../infra/infra-manager.ts";
import { ShellDiskMonitor } from "../infra/disk-monitor.ts";
import { SdkAgentRunner } from "../agent/sdk-agent-runner.ts";
import { detectCredentials } from "../agent/credentials.ts";
import { HeuristicRouter } from "../engine/router.ts";
import { TaskEngine } from "../engine/task-engine.ts";
import { runTask } from "./run-driver.ts";
import { stdinGateDecider } from "./gate-prompt.ts";
```
(`SqliteStore`, `DockerRunner`, `GitRunner`, `BunCommandRunner`, `grovePaths` are already imported from the `gc` task.)

Add a `case "run":` to the `switch` in `main`, before `default`:
```typescript
    case "run": {
      const yes = argv.includes("--yes");
      const prose = argv.slice(3).filter((a) => !a.startsWith("--")).join(" ").trim();
      if (prose.length === 0) {
        console.log("grove — usage: grove run \"<what you want to do>\" [--yes]");
        return 0;
      }

      const paths = grovePaths();
      mkdirSync(paths.tasksDir, { recursive: true });
      const runner = new BunCommandRunner();
      const repoPath = process.cwd();
      const store = SqliteStore.open(paths.dbFile);
      try {
        const config = await loadConfig(paths);
        const git = new GitRunner(runner, repoPath);
        const worktrees = new GitWorktreeManager(git, paths);
        const compose = new DockerComposeManager(new DockerRunner(runner));
        const infra = new InfraManager(worktrees, compose);
        const agent = new SdkAgentRunner({ env: process.env });
        const engine = new TaskEngine({ store, agent, infra, model: config.agent.model });

        const result = await runTask(prose, {
          engine,
          router: new HeuristicRouter(),
          disk: new ShellDiskMonitor(runner),
          thresholds: config.disk,
          paths,
          repoPath,
          hasCredential: detectCredentials(process.env).present,
          isGitRepo: await git.isGitRepo(),
          yes,
          decide: () => stdinGateDecider(async (p) => prompt(p) ?? ""),
          out: (line) => console.log(line),
        });

        console.log(`\n${result.message}`);
        return result.ok ? 0 : 1;
      } finally {
        store.close();
      }
    }
```

Update the usage string in `printUsage`:
```typescript
  console.log("grove — usage: grove [run \"<prose>\" [--yes] | init | gc [--yes] | doctor | --version]");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/index.run.test.ts`
Expected: PASS — 2 pass. (`grove run "add a page"` with no credential → `runTask` returns the credential error before touching Docker/the agent → exit 1.)

- [ ] **Step 5: Run the full suite, typecheck, and a build smoke test**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck && bun run build && GROVE_HOME=/tmp/grove-run ANTHROPIC_API_KEY= CLAUDE_CODE_OAUTH_TOKEN= ./dist/grove run "add a page"; rm -rf /tmp/grove-run`
Expected: all tests PASS (2 flag-gated skips from earlier plans + the new agent/docker ones); `tsc --noEmit` clean; binary builds; `grove run` with no credential prints the credential error and exits 1 (it does NOT spawn the agent or Docker).

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts test/cli/index.run.test.ts
git commit -m "feat: wire grove run command into the CLI"
```

---

## Task 6: Flag-gated real end-to-end smoke

**Files:**
- Test: `test/cli/run-e2e.test.ts`

A real start→done run against the real agent + real git worktree, only when `GROVE_E2E=1` and a credential is present. Keeps the default suite free of API/Docker.

- [ ] **Step 1: Write the test**

`test/cli/run-e2e.test.ts`:
```typescript
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTask } from "../../src/cli/run-driver.ts";
import { HeuristicRouter } from "../../src/engine/router.ts";
import { TaskEngine } from "../../src/engine/task-engine.ts";
import { SqliteStore } from "../../src/store/sqlite-store.ts";
import { BunCommandRunner } from "../../src/infra/command-runner.ts";
import { GitRunner } from "../../src/infra/git-runner.ts";
import { GitWorktreeManager } from "../../src/infra/worktree-manager.ts";
import { DockerRunner } from "../../src/infra/docker-runner.ts";
import { DockerComposeManager } from "../../src/infra/compose-manager.ts";
import { InfraManager } from "../../src/infra/infra-manager.ts";
import { ShellDiskMonitor } from "../../src/infra/disk-monitor.ts";
import { SdkAgentRunner } from "../../src/agent/sdk-agent-runner.ts";
import { hasCredentials } from "../../src/agent/credentials.ts";
import { resolvePaths } from "../../src/config/paths.ts";

const ENABLED = process.env.GROVE_E2E === "1" && hasCredentials(process.env);
const maybe = ENABLED ? test : test.skip;

let repo: string;
let groveRoot: string;
async function sh(cmd: string, args: string[], cwd: string) {
  await Bun.spawn([cmd, ...args], { cwd, stdout: "pipe", stderr: "pipe" }).exited;
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "grove-e2e-repo-"));
  groveRoot = mkdtempSync(join(tmpdir(), "grove-e2e-home-"));
  await sh("git", ["init", "-q", "-b", "main"], repo);
  await sh("git", ["config", "user.email", "t@t.test"], repo);
  await sh("git", ["config", "user.name", "t"], repo);
  writeFileSync(join(repo, "README.md"), "# test\n");
  await sh("git", ["add", "."], repo);
  await sh("git", ["commit", "-q", "-m", "init"], repo);
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(groveRoot, { recursive: true, force: true });
});

maybe("runs a trivial task start -> done with --yes against the real agent", async () => {
  const paths = resolvePaths(groveRoot);
  const runner = new BunCommandRunner();
  const git = new GitRunner(runner, repo);
  const store = SqliteStore.open(paths.dbFile);
  const infra = new InfraManager(new GitWorktreeManager(git, paths), new DockerComposeManager(new DockerRunner(runner)));
  const engine = new TaskEngine({ store, agent: new SdkAgentRunner({ env: process.env }), infra, model: process.env.GROVE_AGENT_MODEL ?? "claude-opus-4-8" });

  const result = await runTask("add a file hello.txt containing the word hello", {
    engine,
    router: new HeuristicRouter(),
    disk: new ShellDiskMonitor(runner),
    thresholds: { warnBytes: 0, blockBytes: 0 },
    paths,
    repoPath: repo,
    hasCredential: true,
    isGitRepo: true,
    yes: true,
    decide: async () => ({ kind: "approve" }),
    out: () => {},
  });
  store.close();

  // A trivial task should complete; if the agent blocks, that's still a non-throwing terminal state.
  expect(["done", "blocked"]).toContain(result.status);
}, 600000);
```

- [ ] **Step 2: Run the test (default: skipped)**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/run-e2e.test.ts`
Expected: PASS — the test is **skipped** (no `GROVE_E2E=1`), suite passes, no API/Docker.

- [ ] **Step 3: (Optional) run it for real**

Run (only if you have a credential + Docker and want to verify): `export PATH="$HOME/.bun/bin:$PATH"; GROVE_E2E=1 bun test test/cli/run-e2e.test.ts`. OPTIONAL — slow (real agent), needs a credential; skip if unavailable. Report what happened if you run it; do NOT modify the test to force it.

- [ ] **Step 4: Commit**

```bash
git add test/cli/run-e2e.test.ts
git commit -m "test: flag-gated real end-to-end grove run smoke"
```

---

## Self-Review (completed during planning)

**Spec coverage (Plan 4b slice of §6.0 Router + §1 entry + §5/§8 wiring):**
- `Router` interface + heuristic classification (§6.0; brainstorm decision: heuristic for v1, LLM adapter for v1.1) → Task 1 ✓; `debug` → `issue` mapping + "treat as task / v1.1" note → Task 3 ✓
- Real `InfraManager`/`SdkAgentRunner`/`DiskMonitor` wired into the engine via its interfaces (§5.3/§6.2) → Task 5 ✓ (engine unchanged — interfaces were ready)
- Disk-gate before provisioning, block < threshold (§8.2) → Task 3 ✓
- Preflight: credential + git repo before provisioning (§9) → Task 3 ✓
- Headless `grove run` driver with interactive gates + `--yes`, live feed, terminal handling (brainstorm decision) → Tasks 3–5 ✓
- The `confirmGate` done-guard carry-forward → Task 2 ✓
- Flag-gated real E2E (§10) → Task 6 ✓

**Intentionally deferred (not gaps):** the LLM-backed Router (v1.1, behind the interface); the Ink TUI (Plan 5, a second consumer of the engine — `grove run` is the headless first consumer); the debug *workflow* (v1.1; the engine runs the task workflow for an `issue` kind in v1); per-step live *token* streaming (the driver streams tool_use/notice; the TUI does token-level); the provision-throw cleanup and `composeProjectFor` hoist (engine carry-forwards, can land here or 4c); `user_version` migration framework. The driver subscribes after `startTask`, so the very first phase's events are not live-streamed (its summary is printed) — acceptable for a headless driver; the TUI reconstructs the first phase from the store.

**Placeholder scan:** none — every code/test step is complete.

**Type consistency:** `Router`/`RouterResult`/`RouterKind` + `HeuristicRouter` (Task 1), the `confirmGate` done-guard (Task 2), `RunEngine`/`RunDeps`/`RunResult`/`runTask` (Task 3), `ReadLine`/`stdinGateDecider` (Task 4), and the CLI wiring (Task 5) are defined once and used consistently. `RunEngine` is a structural subset of `TaskEngine` (verified by the CLI passing a real `TaskEngine`). `GateDecision`/`StartTaskInput` are reused from the engine; `TaskKind` (`task`/`issue`) is the domain type; the driver maps router `debug`→`issue`. `DiskThresholds`/`DiskMonitor` come from Plan 2a; `phaseDefinition` from Plan 3.
