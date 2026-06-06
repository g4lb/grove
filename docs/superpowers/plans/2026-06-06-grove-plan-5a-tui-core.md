# grove — Plan 5a: TUI Core (Ink) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The grove TUI core — launch `grove` (no args) into a free-text prompt, type a request, watch the agent work live, and approve / request-changes / stop at each gate, all in the terminal. A second consumer of the engine alongside the headless `grove run` driver.

**Architecture:** Logic is split from rendering so most of it is testable without Ink. A plain `TaskRunController` (no Ink) holds the run state (`feed`/`status`/`task`) and drives the engine (`startTask`/`confirmGate` with a new optional `onEvent` hook that captures the first phase too). A thin Ink `<App>` (React) renders the controller's snapshot and maps keypresses (prose input, then `a`/`r`/`s`) to controller calls. The controller is heavily unit-tested; the Ink layer gets `ink-testing-library` render + input tests.

**Tech Stack:** Bun (`bun test`), TypeScript (strict), **Ink + React** (new), `ink-testing-library`. Plan 1–4b modules: `TaskEngine`, `HeuristicRouter`, `SqliteStore`, `InfraManager`, `SdkAgentRunner`, `ShellDiskMonitor`, `detectCredentials`, `loadConfig`, domain types.

---

## Context for the implementer (read once)

Plans 1–4b are merged on `main`. Relevant:
- `src/engine/task-engine.ts` — `TaskEngine`: `startTask(input)`, `confirmGate(taskId, decision)` (decision = approve/rerun{feedback?}/stop), `subscribe(taskId, handler): ()=>void`, `getStatus`. `StartTaskInput {title, description?, repoPath, kind}`, `GateDecision`. A `done` task rejects `confirmGate`.
- `src/engine/router.ts` — `Router`, `HeuristicRouter`, `RouterResult {kind:"task"|"debug", ...}`.
- `src/cli/run-driver.ts` — `RunEngine`/`runTask` (the headless driver; reference for the controller's shape, but the TUI uses its own controller, not `runTask`'s stdin loop).
- `src/domain/types.ts` — `Task {id,title,description,kind,status,currentPhase,...}`, `TaskStatus = "running"|"waiting_confirm"|"blocked"|"done"|"stopped"`, `TaskKind = "task"|"issue"`.
- `src/agent/events.ts` — `AgentEvent` (token/tool_use/notice).
- `src/config/config.ts` — `loadConfig`; `src/config/paths.ts` — `resolvePaths`; `src/agent/credentials.ts` — `detectCredentials`.
- `src/cli/index.ts` — dispatch for `run`/`init`/`gc`/`doctor`/`--version`, `default` → `printUsage`, `grovePaths()` helper. Currently no-args falls to `default` (usage).
- `src/infra/*` — `BunCommandRunner`, `GitRunner`, `GitWorktreeManager`, `DockerRunner`, `DockerComposeManager`, `InfraManager`, `ShellDiskMonitor`. `src/agent/sdk-agent-runner.ts` — `SdkAgentRunner`.

**Environment quirk:** bun is at `~/.bun/bin/bun`, NOT on PATH. Prepend `export PATH="$HOME/.bun/bin:$PATH";` to every bun command. Verify: `export PATH="$HOME/.bun/bin:$PATH"; bun --version` → `1.3.14`. Relative imports use explicit extensions (`.ts`, and `.tsx` for React components). TDD throughout. One logical change per commit.

**Ink + Bun + compiled binary:** Ink and React are pure JS (no native subprocess like the agent SDK), so they bundle cleanly into `bun build --compile`. JSX lives in `.tsx` files; tsconfig gets `"jsx": "react-jsx"` (Task 2). The default `bun test` suite stays fast — the controller tests use fakes; the Ink tests use `ink-testing-library` (in-memory render, no real TTY).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/task-engine.ts` | (modify) add optional `onEvent` to `startTask` + `confirmGate` |
| `src/app/controller.ts` | `TaskRunController` + `ControllerEngine`/`ControllerView` (plain logic, no Ink) |
| `src/app/app.tsx` | `<App>` — the Ink/React component (prompt + feed + gate actions) |
| `src/cli/index.ts` | (modify) `grove` (no args) launches the TUI |
| `tsconfig.json` | (modify) add `"jsx": "react-jsx"` |
| `test/engine/*`, `test/app/*` | one test file per module |

---

## Task 1: Engine `onEvent` hook

**Files:**
- Modify: `src/engine/task-engine.ts`
- Test: `test/engine/on-event.test.ts`

Add an optional `onEvent` callback to `startTask`/`confirmGate` so a caller (the TUI) receives events from the **first** phase too (the existing `subscribe` can't, since the id doesn't exist until `startTask` runs). Implemented by temporarily subscribing the callback around the run.

- [ ] **Step 1: Write the failing test**

`test/engine/on-event.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { buildEngine, ok } from "./helpers.ts";
import type { AgentEvent } from "../../src/agent/events.ts";

test("startTask delivers first-phase events to onEvent", async () => {
  const { engine } = buildEngine({
    brainstorm: ok("brainstorm", "/wt/.grove/design.md", [
      { type: "notice", message: "phase brainstorm started" },
      { type: "tool_use", tool: "Write", input: {} },
    ]),
  });
  const seen: AgentEvent[] = [];
  await engine.startTask({ title: "x", repoPath: "/r", kind: "task" }, (e) => seen.push(e));
  expect(seen).toContainEqual({ type: "tool_use", tool: "Write", input: {} });
});

test("confirmGate delivers the advanced phase's events to onEvent", async () => {
  const { engine } = buildEngine({
    brainstorm: ok("brainstorm", "/wt/.grove/design.md"),
    plan: ok("plan", "/wt/.grove/plan.md", [{ type: "tool_use", tool: "Edit", input: {} }]),
  });
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  const seen: AgentEvent[] = [];
  await engine.confirmGate(t0.id, { kind: "approve" }, (e) => seen.push(e));
  expect(seen).toContainEqual({ type: "tool_use", tool: "Edit", input: {} });
});

test("onEvent is unsubscribed after the call (no leak to a later run)", async () => {
  const { engine } = buildEngine({
    brainstorm: ok("brainstorm", "/wt/.grove/design.md", [{ type: "notice", message: "a" }]),
    plan: ok("plan", "/wt/.grove/plan.md", [{ type: "notice", message: "b" }]),
  });
  const seen: AgentEvent[] = [];
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" }, (e) => seen.push(e));
  const before = seen.length;
  await engine.confirmGate(t0.id, { kind: "approve" }); // no onEvent this time
  expect(seen.length).toBe(before); // the startTask onEvent did not receive plan's events
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/engine/on-event.test.ts`
Expected: FAIL — `startTask`/`confirmGate` don't accept a second argument / `seen` stays empty.

- [ ] **Step 3: Edit `src/engine/task-engine.ts`**

Add a type alias near the top (after the existing `type EventHandler` if present, or just before the class):
```typescript
type OnEvent = (event: AgentEvent) => void;
```
(`AgentEvent` is already imported.)

Change `startTask`'s signature and wrap its body so `onEvent` is subscribed around the run. The current method:
```typescript
  async startTask(input: StartTaskInput): Promise<Task> {
    const task = this.store.createTask({
      title: input.title,
      description: input.description,
      kind: input.kind,
      repoPath: input.repoPath,
    });
    const result = await this.infra.provision(task.id, input.title);
    this.store.updateTask(task.id, {
      worktreePath: result.worktree.worktreePath,
      branch: result.worktree.branch,
      composeProject: result.composeStarted ? `grove-${task.id}` : null,
    });
    this.store.appendEvent({ taskId: task.id, type: "provisioned", payload: { branch: result.worktree.branch } });
    return this.runFrom(task.id, "brainstorm");
  }
```
becomes:
```typescript
  async startTask(input: StartTaskInput, onEvent?: OnEvent): Promise<Task> {
    const task = this.store.createTask({
      title: input.title,
      description: input.description,
      kind: input.kind,
      repoPath: input.repoPath,
    });
    const off = onEvent ? this.subscribe(task.id, onEvent) : () => {};
    try {
      const result = await this.infra.provision(task.id, input.title);
      this.store.updateTask(task.id, {
        worktreePath: result.worktree.worktreePath,
        branch: result.worktree.branch,
        composeProject: result.composeStarted ? `grove-${task.id}` : null,
      });
      this.store.appendEvent({ taskId: task.id, type: "provisioned", payload: { branch: result.worktree.branch } });
      return await this.runFrom(task.id, "brainstorm");
    } finally {
      off();
    }
  }
```

Change `confirmGate`'s signature and wrap the runs. The current method (abridged):
```typescript
  async confirmGate(taskId: string, decision: GateDecision): Promise<Task> {
    const task = this.requireTask(taskId);
    if (task.status === "done") {
      throw new Error(`cannot ${decision.kind} a completed task ${taskId}`);
    }
    if (decision.kind === "stop") {
      return this.store.updateTask(taskId, { status: "stopped" });
    }
    if (decision.kind === "rerun") {
      return this.runFrom(taskId, task.currentPhase, decision.feedback);
    }
    if (task.status !== "waiting_confirm") {
      throw new Error(`cannot approve task ${taskId} in status ${task.status}`);
    }
    const next = nextPhase(task.currentPhase);
    if (!next) throw new Error(`no phase after ${task.currentPhase}`);
    return this.runFrom(taskId, next);
  }
```
becomes (add `onEvent?` param; subscribe around the two `runFrom` paths — the `stop` path emits nothing so it needs no wrapping):
```typescript
  async confirmGate(taskId: string, decision: GateDecision, onEvent?: OnEvent): Promise<Task> {
    const task = this.requireTask(taskId);
    if (task.status === "done") {
      throw new Error(`cannot ${decision.kind} a completed task ${taskId}`);
    }
    if (decision.kind === "stop") {
      return this.store.updateTask(taskId, { status: "stopped" });
    }
    const off = onEvent ? this.subscribe(taskId, onEvent) : () => {};
    try {
      if (decision.kind === "rerun") {
        return await this.runFrom(taskId, task.currentPhase, decision.feedback);
      }
      if (task.status !== "waiting_confirm") {
        throw new Error(`cannot approve task ${taskId} in status ${task.status}`);
      }
      const next = nextPhase(task.currentPhase);
      if (!next) throw new Error(`no phase after ${task.currentPhase}`);
      return await this.runFrom(taskId, next);
    } finally {
      off();
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/engine/on-event.test.ts`
Expected: PASS — 3 pass.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck`
Expected: all pass (existing engine/driver tests unaffected — `onEvent` is optional); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/engine/task-engine.ts test/engine/on-event.test.ts
git commit -m "feat: add optional onEvent hook to startTask and confirmGate"
```

---

## Task 2: Deps + tsconfig JSX + TaskRunController

**Files:**
- Modify: `package.json` (deps), `tsconfig.json` (jsx)
- Create: `src/app/controller.ts`
- Test: `test/app/controller.test.ts`

- [ ] **Step 1: Add dependencies**

Run:
```
export PATH="$HOME/.bun/bin:$PATH"; bun add ink react && bun add -d @types/react ink-testing-library
```
Expected: `ink`, `react` in `dependencies`; `@types/react`, `ink-testing-library` in `devDependencies`. Report the resolved versions.

- [ ] **Step 2: Enable JSX in `tsconfig.json`**

Add `"jsx": "react-jsx"` to `compilerOptions` (it only affects `.tsx` files; existing `.ts` is unchanged):
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "jsx": "react-jsx"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Write the failing test**

`test/app/controller.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { TaskRunController, type ControllerEngine } from "../../src/app/controller.ts";
import { HeuristicRouter } from "../../src/engine/router.ts";
import type { Task } from "../../src/domain/types.ts";
import type { AgentEvent } from "../../src/agent/events.ts";
import type { GateDecision } from "../../src/engine/task-engine.ts";

function task(over: Partial<Task>): Task {
  return {
    id: "task_1",
    title: "x",
    description: null,
    kind: "task",
    status: "waiting_confirm",
    currentPhase: "brainstorm",
    repoPath: "/r",
    worktreePath: "/wt",
    branch: "grove/task_1",
    composeProject: null,
    createdAt: "t",
    updatedAt: "t",
    ...over,
  };
}

// Fake engine: emits the queued events to onEvent, then resolves with the next scripted task.
function fakeEngine(states: Task[], events: AgentEvent[][]): ControllerEngine {
  let i = 0;
  return {
    async startTask(_input, onEvent) {
      (events[i] ?? []).forEach((e) => onEvent?.(e));
      return states[i++]!;
    },
    async confirmGate(_id, _d: GateDecision, onEvent) {
      (events[i] ?? []).forEach((e) => onEvent?.(e));
      return states[i++]!;
    },
  };
}

test("start classifies, runs, accumulates events, and reaches the gate", async () => {
  const engine = fakeEngine(
    [task({ status: "waiting_confirm", currentPhase: "brainstorm" })],
    [[{ type: "notice", message: "phase brainstorm started" }, { type: "tool_use", tool: "Write", input: {} }]],
  );
  const c = new TaskRunController(engine, new HeuristicRouter(), "/repo");
  await c.start("add a settings page");
  const v = c.snapshot();
  expect(v.state).toBe("waiting_confirm");
  expect(v.feed.join("\n")).toContain("Write");
  expect(v.message.toLowerCase()).toContain("gate");
});

test("decide approve advances to done", async () => {
  const engine = fakeEngine(
    [task({ status: "waiting_confirm", currentPhase: "brainstorm" }), task({ status: "done", currentPhase: "finish" })],
    [[], []],
  );
  const c = new TaskRunController(engine, new HeuristicRouter(), "/repo");
  await c.start("add a page");
  await c.decide({ kind: "approve" });
  expect(c.snapshot().state).toBe("done");
  expect(c.snapshot().message.toLowerCase()).toContain("complete");
});

test("decide stop stops the task", async () => {
  const engine = fakeEngine(
    [task({ status: "waiting_confirm", currentPhase: "brainstorm" }), task({ status: "stopped", currentPhase: "brainstorm" })],
    [[], []],
  );
  const c = new TaskRunController(engine, new HeuristicRouter(), "/repo");
  await c.start("add a page");
  await c.decide({ kind: "stop" });
  expect(c.snapshot().state).toBe("stopped");
});

test("a debug-classified request is noted in the feed", async () => {
  const engine = fakeEngine([task({ status: "done", currentPhase: "finish" })], [[]]);
  const c = new TaskRunController(engine, new HeuristicRouter(), "/repo");
  await c.start("fix the broken login");
  expect(c.snapshot().feed.join("\n").toLowerCase()).toContain("debug");
});

test("onChange fires when state changes", async () => {
  const engine = fakeEngine([task({ status: "done", currentPhase: "finish" })], [[{ type: "notice", message: "x" }]]);
  const c = new TaskRunController(engine, new HeuristicRouter(), "/repo");
  let changes = 0;
  c.onChange = () => {
    changes++;
  };
  await c.start("add a page");
  expect(changes).toBeGreaterThan(0);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/app/controller.test.ts`
Expected: FAIL — "Cannot find module '../../src/app/controller.ts'".

- [ ] **Step 5: Write the implementation**

`src/app/controller.ts`:
```typescript
import type { Task, TaskKind } from "../domain/types.ts";
import type { AgentEvent } from "../agent/events.ts";
import type { StartTaskInput, GateDecision } from "../engine/task-engine.ts";
import type { Router } from "../engine/router.ts";

/** The engine surface the controller needs (the real TaskEngine satisfies it). */
export interface ControllerEngine {
  startTask(input: StartTaskInput, onEvent?: (e: AgentEvent) => void): Promise<Task>;
  confirmGate(taskId: string, decision: GateDecision, onEvent?: (e: AgentEvent) => void): Promise<Task>;
}

export type RunState = "idle" | "running" | "waiting_confirm" | "blocked" | "done" | "stopped";

export interface ControllerView {
  state: RunState;
  task: Task | null;
  feed: string[];
  message: string;
}

/** Holds TUI run state and drives the engine. No Ink — fully unit-testable. */
export class TaskRunController {
  /** Called whenever the view changes; the Ink layer wires this to a re-render. */
  onChange: () => void = () => {};

  private view: ControllerView = { state: "idle", task: null, feed: [], message: "" };

  constructor(
    private engine: ControllerEngine,
    private router: Router,
    private repoPath: string,
  ) {}

  snapshot(): ControllerView {
    return { ...this.view, feed: [...this.view.feed] };
  }

  private push(line: string): void {
    this.view.feed.push(line);
    this.onChange();
  }

  private set(partial: Partial<ControllerView>): void {
    this.view = { ...this.view, ...partial };
    this.onChange();
  }

  private onEvent = (event: AgentEvent): void => {
    if (event.type === "tool_use") this.push(`· ${event.tool}`);
    else if (event.type === "notice") this.push(`· ${event.message}`);
    // raw tokens are intentionally not line-spammed in the feed
  };

  async start(prose: string): Promise<void> {
    const routed = await this.router.classify(prose);
    this.push(`detected: ${routed.kind}`);
    const kind: TaskKind = routed.kind === "debug" ? "issue" : "task";
    if (routed.kind === "debug") this.push("debugging is coming in v1.1 — running as a task");
    this.set({ state: "running" });
    const task = await this.engine.startTask({ title: prose, repoPath: this.repoPath, kind }, this.onEvent);
    this.applyTask(task);
  }

  async decide(decision: GateDecision): Promise<void> {
    if (!this.view.task) return;
    this.set({ state: "running" });
    const task = await this.engine.confirmGate(this.view.task.id, decision, this.onEvent);
    this.applyTask(task);
  }

  private applyTask(task: Task): void {
    let message = "";
    if (task.status === "waiting_confirm") message = `gate — ${task.currentPhase} done`;
    else if (task.status === "done") message = "task complete";
    else if (task.status === "blocked") message = `blocked at ${task.currentPhase}`;
    else if (task.status === "stopped") message = `stopped at ${task.currentPhase}`;
    this.set({ state: task.status, task, message });
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/app/controller.test.ts`
Expected: PASS — 5 pass.

- [ ] **Step 7: Run the full suite + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck`
Expected: all pass; `tsc --noEmit` clean (the `jsx` option doesn't affect existing `.ts`).

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock tsconfig.json src/app/controller.ts test/app/controller.test.ts
git commit -m "feat: add Ink/React deps, JSX config, and TaskRunController"
```

---

## Task 3: Ink `<App>` component

**Files:**
- Create: `src/app/app.tsx`
- Test: `test/app/app.test.tsx`

A thin Ink component: renders the controller's snapshot, takes prose input in the idle state, and maps `a`/`r`/`s` (and feedback text) to `controller.decide(...)` at a gate. Tested with `ink-testing-library` + a spy controller (so no real engine/async).

- [ ] **Step 1: Write the failing test**

`test/app/app.test.tsx`:
```typescript
import { test, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../../src/app/app.tsx";
import type { ControllerView } from "../../src/app/controller.ts";
import type { GateDecision } from "../../src/engine/task-engine.ts";

// A spy that satisfies the props App needs (snapshot + onChange + start + decide).
function spyController(view: ControllerView) {
  return {
    view,
    onChange: () => {},
    starts: [] as string[],
    decisions: [] as GateDecision[],
    snapshot() {
      return this.view;
    },
    async start(prose: string) {
      this.starts.push(prose);
    },
    async decide(d: GateDecision) {
      this.decisions.push(d);
    },
  };
}

const idle: ControllerView = { state: "idle", task: null, feed: [], message: "" };

function delay(ms = 20) {
  return new Promise((r) => setTimeout(r, ms));
}

test("renders the grove prompt in the idle state", () => {
  const c = spyController(idle);
  const { lastFrame } = render(<App controller={c as any} />);
  expect(lastFrame()).toContain("grove");
});

test("typing a request and pressing enter calls controller.start", async () => {
  const c = spyController(idle);
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("add a settings page");
  stdin.write("\r");
  await delay();
  expect(c.starts).toContain("add a settings page");
});

test("renders the feed and the gate action bar at a gate", () => {
  const c = spyController({
    state: "waiting_confirm",
    task: null,
    feed: ["· Write", "· Edit"],
    message: "gate — brainstorm done",
  });
  const { lastFrame } = render(<App controller={c as any} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("· Write");
  expect(frame).toContain("brainstorm done");
  expect(frame.toLowerCase()).toContain("approve");
});

test("pressing 'a' at a gate approves", async () => {
  const c = spyController({ state: "waiting_confirm", task: null, feed: [], message: "gate" });
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("a");
  await delay();
  expect(c.decisions).toContainEqual({ kind: "approve" });
});

test("pressing 's' at a gate stops", async () => {
  const c = spyController({ state: "waiting_confirm", task: null, feed: [], message: "gate" });
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("s");
  await delay();
  expect(c.decisions).toContainEqual({ kind: "stop" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/app/app.test.tsx`
Expected: FAIL — "Cannot find module '../../src/app/app.tsx'".

- [ ] **Step 3: Write the implementation**

`src/app/app.tsx`:
```tsx
import React, { useState, useEffect, useReducer } from "react";
import { Box, Text, useInput } from "ink";
import type { TaskRunController } from "./controller.ts";

export interface AppProps {
  controller: Pick<TaskRunController, "snapshot" | "start" | "decide"> & { onChange: () => void };
}

export function App({ controller }: AppProps): React.ReactElement {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const [input, setInput] = useState("");
  const [feedbackMode, setFeedbackMode] = useState(false);

  // Re-render whenever the controller's state changes.
  useEffect(() => {
    controller.onChange = () => forceRender();
    return () => {
      controller.onChange = () => {};
    };
  }, [controller]);

  const view = controller.snapshot();

  useInput((char, key) => {
    if (view.state === "idle") {
      if (key.return) {
        const prose = input.trim();
        if (prose.length > 0) {
          setInput("");
          void controller.start(prose);
        }
      } else if (key.backspace || key.delete) {
        setInput((s) => s.slice(0, -1));
      } else if (char && !key.ctrl && !key.meta) {
        setInput((s) => s + char);
      }
    } else if (view.state === "waiting_confirm") {
      if (feedbackMode) {
        if (key.return) {
          const fb = input.trim();
          setInput("");
          setFeedbackMode(false);
          void controller.decide({ kind: "rerun", feedback: fb.length > 0 ? fb : undefined });
        } else if (key.backspace || key.delete) {
          setInput((s) => s.slice(0, -1));
        } else if (char && !key.ctrl && !key.meta) {
          setInput((s) => s + char);
        }
      } else if (char === "a") {
        void controller.decide({ kind: "approve" });
      } else if (char === "s") {
        void controller.decide({ kind: "stop" });
      } else if (char === "r") {
        setFeedbackMode(true);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="green">grove</Text>

      {view.state === "idle" && <Text>{"› "}{input || "what do you want to work on?"}</Text>}

      {view.feed.map((line, i) => (
        <Text key={i} dimColor>
          {line}
        </Text>
      ))}

      {view.message.length > 0 && <Text>{view.message}</Text>}

      {view.state === "running" && <Text dimColor>working…</Text>}

      {view.state === "waiting_confirm" && !feedbackMode && (
        <Text color="cyan">[a]pprove / [r]equest changes / [s]top</Text>
      )}
      {view.state === "waiting_confirm" && feedbackMode && <Text>{"changes: "}{input}</Text>}
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/app/app.test.tsx`
Expected: PASS — 5 pass. (If an input test is flaky on timing, increase the `delay()` — do NOT remove the assertion.)

- [ ] **Step 5: Run the full suite + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck`
Expected: all pass; `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/app.tsx test/app/app.test.tsx
git commit -m "feat: add Ink App component (prompt, live feed, gate actions)"
```

---

## Task 4: Launch the TUI from `grove` (no args)

**Files:**
- Modify: `src/cli/index.ts`
- Test: `test/cli/index.tui.test.ts`

`grove` with no args builds the real runtime and launches the TUI — but fails fast (no render) if there's no Anthropic credential, so the test can exercise that path without a real TTY.

- [ ] **Step 1: Write the failing test**

`test/cli/index.tui.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "..", "..", "src", "cli", "index.ts");

async function runCli(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn(["bun", ENTRY, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, ...env },
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

test("grove with no args and no credential fails fast (does not launch the TUI)", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  try {
    const { code, stdout } = await runCli([], {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/index.tui.test.ts`
Expected: FAIL — with no args the CLI prints usage (exit 0), so the credential assertion fails.

- [ ] **Step 3: Update `src/cli/index.ts`**

Add these imports below the existing imports:
```typescript
import React from "react";
import { render } from "ink";
import { App } from "../app/app.tsx";
import { TaskRunController } from "../app/controller.ts";
```

Add a `launchTui` helper above `main` (alongside `grovePaths`):
```typescript
async function launchTui(): Promise<number> {
  const paths = grovePaths();
  mkdirSync(paths.tasksDir, { recursive: true });
  if (!detectCredentials(process.env).present) {
    console.log("no Anthropic credential — set ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN)");
    return 1;
  }
  const runner = new BunCommandRunner();
  const repoPath = process.cwd();
  const config = await loadConfig(paths);
  const store = SqliteStore.open(paths.dbFile);
  const git = new GitRunner(runner, repoPath);
  const worktrees = new GitWorktreeManager(git, paths);
  const compose = new DockerComposeManager(new DockerRunner(runner));
  const infra = new InfraManager(worktrees, compose);
  const agent = new SdkAgentRunner({ env: process.env });
  const engine = new TaskEngine({ store, agent, infra, model: config.agent.model });
  const controller = new TaskRunController(engine, new HeuristicRouter(), repoPath);

  const { waitUntilExit } = render(React.createElement(App, { controller }));
  await waitUntilExit();
  store.close();
  return 0;
}
```

In `main`, change the `switch` so **no command** launches the TUI (a new `case undefined:`), leaving `default` (unknown command) as usage:
```typescript
  const cmd = argv[2];
  switch (cmd) {
    case undefined:
      return launchTui();
    case "-v":
    case "--version":
      // ...unchanged
```
(Keep all existing cases. The `default:` still calls `printUsage()` for an *unrecognized* command.)

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/index.tui.test.ts`
Expected: PASS — 1 pass. (No credential → `launchTui` prints the credential error and returns 1 before any Ink render.)

- [ ] **Step 5: Run the full suite, typecheck, and build smoke**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck && bun run build && echo "built"`
Expected: all tests PASS (3 flag-gated skips); `tsc --noEmit` clean; `dist/grove` compiles with Ink/React bundled. (Do NOT run `./dist/grove` with a credential here — it would launch the interactive TUI and block; the no-credential path is covered by the test, and the App rendering by Task 3.)

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts test/cli/index.tui.test.ts
git commit -m "feat: launch the TUI on grove with no args"
```

---

## Self-Review (completed during planning)

**Spec coverage (Plan 5a slice of §7):**
- Home free-text prompt (REPL), launched by `grove` no-args (§7.1) → Tasks 3–4 ✓
- Task view: live agent feed + gate actions `[a]pprove / [r]equest changes / [s]top` (§7.2/§7.4) → Tasks 2–3 ✓; request-changes free-text feedback → `rerun` (§7.4) → Task 3 feedbackMode ✓
- Engine↔TUI binding via `subscribe`/events (§7.5) → the `onEvent` hook (Task 1) + controller `onEvent` ✓; first-phase events now stream (the hook closes the subscribe-after-startTask gap)
- Ink as the control plane over the engine (§3) → the App is a thin renderer over `TaskRunController` over `TaskEngine` ✓
- Logic decoupled from Ink (testable) → `TaskRunController` unit-tested without Ink; Ink layer via `ink-testing-library` ✓

**Intentionally deferred to 5b (not gaps):** the `/list` dashboard, `/open <id>`, and the first-gate **kind-confirmation** (`[c]hange kind`); per-token live streaming (the feed shows tool_use/notice — token-level can come later); reusing a shared runtime factory between the CLI `run` case and `launchTui` (both build the engine inline for now — a later dedup). The headless `grove run` driver (Plan 4b) is unchanged — the TUI is a parallel consumer.

**Placeholder scan:** none — every code/test step is complete.

**Type consistency:** `OnEvent`/the optional `onEvent` params (Task 1) match the controller's `ControllerEngine` (Task 2). `TaskRunController` (`start`/`decide`/`snapshot`/`onChange`, `ControllerView`/`RunState`) is defined once and consumed by the App (Task 3) and `launchTui` (Task 4). The App's `AppProps.controller` is a structural subset the real `TaskRunController` satisfies. `GateDecision`/`StartTaskInput` reused from the engine; `TaskKind` (`task`/`issue`) is the domain type with the `debug`→`issue` mapping; `RunState` mirrors `TaskStatus` plus `idle`.
