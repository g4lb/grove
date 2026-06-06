# grove — Plan 5b: TUI Navigation (`/list` + `/open`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the v1 TUI — a `/list` dashboard of all tasks (status · kind · phase · title), `/open <id>` and in-list selection to open a task into the run view, and the first-gate kind label. Completes spec §7.3 (and the display half of §7.2).

**Architecture:** Extends the existing `TaskRunController` (Plan 5a) with a navigation layer: prompt input is routed through `submit(input)` which dispatches `/list` / `/open <id>` commands or otherwise runs the prose as a task. A new `mode` (`"prompt" | "list"`) plus `tasks`/`selected` live in the controller view; the Ink `<App>` renders a list screen when `mode === "list"`. The controller stays Ink-free and fully unit-tested; the engine gains a thin `listTasks()` over the existing `Store.queryTasks`.

**Tech Stack:** Bun, TypeScript (strict), Ink + React, `ink-testing-library`. Plans 1–5a are merged on `main`.

---

## Context for the implementer (read once)

- `src/engine/task-engine.ts` — `TaskEngine`: `startTask`/`confirmGate`/`resume`/`getStatus(id)`/`getEvents`/`subscribe`. Holds `this.store` (a `Store`). `Store.queryTasks(query?: TaskQuery): Task[]` returns tasks (newest-first per the store's ordering; pass no query for all).
- `src/store/store.ts` — `Store` interface incl. `queryTasks(query?: TaskQuery): Task[]`, `getTask(id): Task | null`. `TaskQuery` is an optional filter object.
- `src/app/controller.ts` — `TaskRunController(engine, router, repoPath)`: `onChange` listener, `snapshot(): ControllerView`, `start(prose)`, `decide(decision)`, private `push`/`set`/`applyTask`/`onEvent`. `ControllerView { state: RunState; task: Task | null; feed: string[]; message: string }`. `RunState = "idle" | "running" | "waiting_confirm" | "blocked" | "done" | "stopped"`. `ControllerEngine { startTask(input, onEvent?); confirmGate(id, decision, onEvent?) }`.
- `src/app/app.tsx` — Ink `<App>` over the controller: idle prompt, feed, gate actions (`a`/`r`/`s`), terminal quit hint (`q`). Uses `useInput`, `useApp`. `AppProps.controller` is `Pick<TaskRunController, "snapshot"|"start"|"decide"> & { onChange }`.
- `src/cli/index.ts` — `launchTui()` builds the engine + a `TaskRunController` and `render(<App controller={...}/>)`.
- `src/domain/types.ts` — `Task { id, title, description, kind, status, currentPhase, ... updatedAt }`, `TaskKind = "task"|"issue"`, `TaskStatus`, `Phase`.

**Environment quirk:** bun is at `~/.bun/bin/bun`, NOT on PATH. Prepend `export PATH="$HOME/.bun/bin:$PATH";` to every bun command. Verify `bun --version` → `1.3.14`. Relative imports use explicit `.ts`/`.tsx` extensions. TDD throughout. One logical change per commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/task-engine.ts` | (modify) add `listTasks()` over `Store.queryTasks` |
| `src/app/controller.ts` | (modify) `submit(input)` routing + list state (`mode`/`tasks`/`selected`) + `openList`/`selectUp`/`selectDown`/`openSelected`/`openTask`/`backToPrompt` |
| `src/app/app.tsx` | (modify) render the list screen + navigation keys; route prompt input through `submit` |
| `test/engine/*`, `test/app/*` | one test file per change |

---

## Task 1: `TaskEngine.listTasks()`

**Files:**
- Modify: `src/engine/task-engine.ts`
- Test: `test/engine/list-tasks.test.ts`

- [ ] **Step 1: Write the failing test**

`test/engine/list-tasks.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { buildEngine, ok } from "./helpers.ts";

test("listTasks returns all created tasks", async () => {
  const { engine } = buildEngine({ brainstorm: ok("brainstorm", "/wt/.grove/design.md") });
  await engine.startTask({ title: "first task", repoPath: "/r", kind: "task" });
  await engine.startTask({ title: "second task", repoPath: "/r", kind: "task" });

  const tasks = engine.listTasks();
  expect(tasks.length).toBe(2);
  const titles = tasks.map((t) => t.title);
  expect(titles).toContain("first task");
  expect(titles).toContain("second task");
});

test("listTasks is empty before any task is created", () => {
  const { engine } = buildEngine({ brainstorm: ok("brainstorm", "/wt/.grove/design.md") });
  expect(engine.listTasks()).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/engine/list-tasks.test.ts`
Expected: FAIL — `engine.listTasks is not a function`.

- [ ] **Step 3: Add `listTasks` to `src/engine/task-engine.ts`**

Add this method to the `TaskEngine` class, right after `getStatus`:
```typescript
  /** All tasks, for the TUI/CLI list view. */
  listTasks(): Task[] {
    return this.store.queryTasks();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/engine/list-tasks.test.ts`
Expected: PASS — 2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/task-engine.ts test/engine/list-tasks.test.ts
git commit -m "feat: add TaskEngine.listTasks"
```

---

## Task 2: Controller navigation (`submit` routing + list state)

**Files:**
- Modify: `src/app/controller.ts`
- Test: `test/app/controller-nav.test.ts`

Add a `mode`/`tasks`/`selected` to the view, a `lister` dependency (so the controller can read tasks without coupling to the engine's class), and navigation methods. The prompt input is routed through `submit(input)`: `/list` → list mode; `/open <id>` → open that task; anything else → `start(prose)`.

- [ ] **Step 1: Write the failing test**

`test/app/controller-nav.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { TaskRunController, type ControllerEngine } from "../../src/app/controller.ts";
import { HeuristicRouter } from "../../src/engine/router.ts";
import type { Task } from "../../src/domain/types.ts";
import type { GateDecision } from "../../src/engine/task-engine.ts";

function task(over: Partial<Task>): Task {
  return {
    id: "task_1",
    title: "x",
    description: null,
    kind: "task",
    status: "done",
    currentPhase: "finish",
    repoPath: "/r",
    worktreePath: "/wt",
    branch: "grove/task_1",
    composeProject: null,
    createdAt: "t",
    updatedAt: "t",
    ...over,
  };
}

const noEngine: ControllerEngine = {
  async startTask() {
    throw new Error("should not run");
  },
  async confirmGate() {
    throw new Error("should not run");
  },
};

function ctl(tasks: Task[], engine: ControllerEngine = noEngine) {
  const c = new TaskRunController(engine, new HeuristicRouter(), "/repo");
  c.setLister(() => tasks);
  return c;
}

test("submit('/list') switches to list mode and loads tasks", async () => {
  const tasks = [task({ id: "task_1", title: "one" }), task({ id: "task_2", title: "two" })];
  const c = ctl(tasks);
  await c.submit("/list");
  const v = c.snapshot();
  expect(v.mode).toBe("list");
  expect(v.tasks.map((t) => t.id)).toEqual(["task_1", "task_2"]);
  expect(v.selected).toBe(0);
});

test("selectDown/selectUp move the selection within bounds", async () => {
  const c = ctl([task({ id: "a" }), task({ id: "b" }), task({ id: "c" })]);
  await c.submit("/list");
  c.selectDown();
  c.selectDown();
  c.selectDown(); // clamp at last
  expect(c.snapshot().selected).toBe(2);
  c.selectUp();
  expect(c.snapshot().selected).toBe(1);
  c.selectUp();
  c.selectUp(); // clamp at 0
  expect(c.snapshot().selected).toBe(0);
});

test("openSelected opens the highlighted task into the run view", async () => {
  const t = task({ id: "task_42", title: "build it", status: "waiting_confirm", currentPhase: "plan" });
  const c = ctl([t]);
  await c.submit("/list");
  c.openSelected();
  const v = c.snapshot();
  expect(v.mode).toBe("prompt");
  expect(v.task?.id).toBe("task_42");
  expect(v.state).toBe("waiting_confirm");
  expect(v.message.toLowerCase()).toContain("plan");
});

test("submit('/open <id>') opens that task directly", async () => {
  const t = task({ id: "task_7", title: "seven", status: "blocked", currentPhase: "execute" });
  const c = ctl([t]);
  await c.submit("/open task_7");
  const v = c.snapshot();
  expect(v.mode).toBe("prompt");
  expect(v.task?.id).toBe("task_7");
  expect(v.state).toBe("blocked");
});

test("submit('/open <unknown>') reports not found and stays put", async () => {
  const c = ctl([task({ id: "task_1" })]);
  await c.submit("/open nope");
  expect(c.snapshot().feed.join("\n").toLowerCase()).toContain("not found");
});

test("backToPrompt returns to an idle prompt", async () => {
  const c = ctl([task({ id: "a" })]);
  await c.submit("/list");
  c.backToPrompt();
  const v = c.snapshot();
  expect(v.mode).toBe("prompt");
  expect(v.state).toBe("idle");
});

test("submit(prose) runs it as a task (not a command)", async () => {
  let started = false;
  const engine: ControllerEngine = {
    async startTask() {
      started = true;
      return task({ id: "task_1", status: "waiting_confirm", currentPhase: "brainstorm" });
    },
    async confirmGate() {
      return task({});
    },
  };
  const c = ctl([], engine);
  await c.submit("add a settings page");
  expect(started).toBe(true);
  expect(c.snapshot().state).toBe("waiting_confirm");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/app/controller-nav.test.ts`
Expected: FAIL — `setLister`/`submit`/`mode` do not exist.

- [ ] **Step 3: Edit `src/app/controller.ts`**

Add `"list"` navigation to `ControllerView` and a lister. Change the `ControllerView` interface to:
```typescript
export interface ControllerView {
  mode: "prompt" | "list";
  state: RunState;
  task: Task | null;
  feed: string[];
  message: string;
  tasks: Task[];
  selected: number;
}
```
Change the initial `view` to include the new fields:
```typescript
  private view: ControllerView = { mode: "prompt", state: "idle", task: null, feed: [], message: "", tasks: [], selected: 0 };
```
Add a `lister` field + setter (default returns `[]`), near `onChange`:
```typescript
  /** Returns all tasks for the list view; wired by the launcher to the engine. */
  private lister: () => Task[] = () => [];
  setLister(lister: () => Task[]): void {
    this.lister = lister;
  }
```
Add the navigation methods (place after `decide`):
```typescript
  /** Route a prompt submission: `/list`, `/open <id>`, else run as a task. */
  async submit(input: string): Promise<void> {
    const trimmed = input.trim();
    if (trimmed === "/list") {
      this.openList();
      return;
    }
    if (trimmed.startsWith("/open ")) {
      this.openTask(trimmed.slice("/open ".length).trim());
      return;
    }
    await this.start(trimmed);
  }

  openList(): void {
    this.set({ mode: "list", tasks: this.lister(), selected: 0 });
  }

  selectDown(): void {
    const max = this.view.tasks.length - 1;
    this.set({ selected: Math.min(this.view.selected + 1, Math.max(0, max)) });
  }

  selectUp(): void {
    this.set({ selected: Math.max(this.view.selected - 1, 0) });
  }

  openSelected(): void {
    const t = this.view.tasks[this.view.selected];
    if (t) this.loadTask(t);
  }

  openTask(id: string): void {
    const t = this.lister().find((x) => x.id === id);
    if (!t) {
      this.set({ mode: "prompt" });
      this.push(`task not found: ${id}`);
      return;
    }
    this.loadTask(t);
  }

  backToPrompt(): void {
    this.set({ mode: "prompt", state: "idle", task: null, message: "", feed: [] });
  }

  private loadTask(t: Task): void {
    // Reuse applyTask's status→message mapping, then return to the run view.
    this.view = { ...this.view, mode: "prompt", task: t };
    this.applyTask(t);
  }
```
Note: `applyTask` already sets `state`/`task`/`message`; `loadTask` sets `mode: "prompt"` first so the view shows the run screen. (`applyTask` does not touch `mode`/`tasks`/`selected`, so they persist correctly.)

**Also fix the Plan 5a `start()` in-flight Low (carry-forward from PR #7 review):** `start()`'s re-entrancy guard checks `state === "running"` but only sets `running` *after* `await this.router.classify(...)`, so two rapid submits both pass the guard and double-fire. Move the `this.set({ state: "running" })` to immediately after the guard, before the `classify` await:
```typescript
  async start(prose: string): Promise<void> {
    if (this.view.state === "running") return;
    this.set({ state: "running" });
    try {
      const routed = await this.router.classify(prose);
      this.push(`detected: ${routed.kind}`);
      const kind: TaskKind = routed.kind === "debug" ? "issue" : "task";
      if (routed.kind === "debug") this.push("debugging is coming in v1.1 — running as a task");
      const task = await this.engine.startTask({ title: prose, repoPath: this.repoPath, kind }, this.onEvent);
      this.applyTask(task);
    } catch (err) {
      this.set({ state: "blocked", message: `failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
```
Add a test for it in `test/app/controller-nav.test.ts`:
```typescript
test("start is a no-op while already running (guard covers the classify await)", async () => {
  let calls = 0;
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => (release = r));
  const engine: ControllerEngine = {
    async startTask() {
      calls++;
      await gate;
      return task({ id: "task_1", status: "waiting_confirm", currentPhase: "brainstorm" });
    },
    async confirmGate() {
      return task({});
    },
  };
  const c = ctl([], engine);
  const p1 = c.submit("add a page");
  const p2 = c.submit("add a page again"); // already running → no-op
  release!();
  await Promise.all([p1, p2]);
  expect(calls).toBe(1);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/app/controller-nav.test.ts`
Expected: PASS — 7 pass.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck`
Expected: all pass. NOTE: existing `test/app/controller.test.ts` constructs `ControllerView` literals and reads `snapshot()` — adding fields to `ControllerView` with defaults in the initial `view` keeps those passing, but if any existing test builds a full `ControllerView` literal it must add `mode`/`tasks`/`selected`. If a pre-existing test fails to compile for that reason, update that literal (do NOT weaken assertions). Typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/controller.ts test/app/controller-nav.test.ts
git commit -m "feat: add /list and /open navigation to the controller"
```

---

## Task 3: App list view + navigation keys

**Files:**
- Modify: `src/app/app.tsx`
- Test: `test/app/app-nav.test.tsx`

Route prompt input through `submit` (so `/list`/`/open` work), render the list dashboard when `mode === "list"`, and map list-mode keys: `↑`/`↓` move selection, `Enter`/`o` open, `Esc` back to prompt.

- [ ] **Step 1: Write the failing test**

`test/app/app-nav.test.tsx`:
```typescript
import { test, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../../src/app/app.tsx";
import type { ControllerView } from "../../src/app/controller.ts";
import type { Task } from "../../src/domain/types.ts";
import type { GateDecision } from "../../src/engine/task-engine.ts";

function task(over: Partial<Task>): Task {
  return {
    id: "task_1", title: "x", description: null, kind: "task", status: "done",
    currentPhase: "finish", repoPath: "/r", worktreePath: "/wt", branch: "b",
    composeProject: null, createdAt: "t", updatedAt: "t", ...over,
  };
}

function spyController(view: ControllerView) {
  return {
    view,
    onChange: () => {},
    submits: [] as string[],
    nav: [] as string[],
    snapshot() { return this.view; },
    async start() {},
    async decide(_d: GateDecision) {},
    async submit(s: string) { this.submits.push(s); },
    selectUp() { this.nav.push("up"); },
    selectDown() { this.nav.push("down"); },
    openSelected() { this.nav.push("open"); },
    backToPrompt() { this.nav.push("back"); },
  };
}

const idle: ControllerView = { mode: "prompt", state: "idle", task: null, feed: [], message: "", tasks: [], selected: 0 };
function delay(ms = 30) { return new Promise((r) => setTimeout(r, ms)); }

test("idle Enter routes input through submit (so /list works)", async () => {
  const c = spyController(idle);
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("/list");
  stdin.write("\r");
  await delay();
  expect(c.submits).toContain("/list");
});

test("renders the list dashboard with task rows", () => {
  const c = spyController({
    ...idle,
    mode: "list",
    tasks: [task({ id: "task_1", title: "build login", status: "waiting_confirm", currentPhase: "plan", kind: "task" })],
    selected: 0,
  });
  const { lastFrame } = render(<App controller={c as any} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("build login");
  expect(frame).toContain("waiting_confirm");
  expect(frame).toContain("plan");
});

test("list-mode arrow keys move the selection", async () => {
  const c = spyController({ ...idle, mode: "list", tasks: [task({ id: "a" }), task({ id: "b" })], selected: 0 });
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("[B"); // down arrow
  await delay();
  expect(c.nav).toContain("down");
});

test("list-mode 'o' opens the selected task", async () => {
  const c = spyController({ ...idle, mode: "list", tasks: [task({ id: "a" })], selected: 0 });
  const { stdin } = render(<App controller={c as any} />);
  stdin.write("o");
  await delay();
  expect(c.nav).toContain("open");
});

test("list-mode Esc returns to the prompt", async () => {
  const c = spyController({ ...idle, mode: "list", tasks: [task({ id: "a" })], selected: 0 });
  const { stdin } = render(<App controller={c as any} />);
  stdin.write(""); // escape
  await delay();
  expect(c.nav).toContain("back");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/app/app-nav.test.tsx`
Expected: FAIL — App doesn't route through `submit`, has no list view, and `AppProps` doesn't include the nav methods.

- [ ] **Step 3: Edit `src/app/app.tsx`**

Widen `AppProps.controller` to include the nav methods:
```tsx
export interface AppProps {
  controller: Pick<
    TaskRunController,
    "snapshot" | "start" | "decide" | "submit" | "selectUp" | "selectDown" | "openSelected" | "backToPrompt"
  > & { onChange: () => void };
}
```
Change the idle Enter handler to call `submit` instead of `start` — in the `useInput` callback's idle branch:
```tsx
      if (key.return) {
        const prose = input.trim();
        if (prose.length > 0) {
          setInput("");
          void controller.submit(prose);
        }
      } else if (key.backspace || key.delete) {
```
Add a list-mode branch at the TOP of the `useInput` callback (before the `terminal` / `idle` branches):
```tsx
    if (view.mode === "list") {
      if (key.upArrow) controller.selectUp();
      else if (key.downArrow) controller.selectDown();
      else if (key.return || char === "o") controller.openSelected();
      else if (key.escape) controller.backToPrompt();
      return;
    }
```
Add the list-screen rendering. Replace the single returned `<Box>` so that when `mode === "list"` it renders the dashboard, else the existing run view. Concretely, at the start of the returned JSX expression, branch on mode:
```tsx
  if (view.mode === "list") {
    return (
      <Box flexDirection="column">
        <Text color="green">grove — tasks</Text>
        {view.tasks.length === 0 && <Text dimColor>no tasks yet</Text>}
        {view.tasks.map((t, i) => (
          <Text key={t.id} color={i === view.selected ? "cyan" : undefined}>
            {i === view.selected ? "› " : "  "}
            {t.status.padEnd(15)} {t.kind.padEnd(6)} {t.currentPhase.padEnd(10)} {t.title}
          </Text>
        ))}
        <Text dimColor>↑/↓ select · enter/o open · esc back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* ...existing run-view JSX unchanged... */}
    </Box>
  );
```
(Keep the existing run-view JSX exactly as-is in the second `return`. The `useInput` callback already returned early for list mode, so the run-view input branches only run in prompt mode.)

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/app/app-nav.test.tsx`
Expected: PASS — 5 pass. (Bump `delay()` if any input test is timing-flaky; do not weaken assertions.)

- [ ] **Step 5: Run the full suite, typecheck, and build**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck && bun run build && echo built`
Expected: all pass (3 flag-gated skips); typecheck clean; `dist/grove` compiles. Confirm the existing `test/app/app.test.tsx` still passes (the run-view rendering + a/r/s + quit are unchanged; idle Enter now goes through `submit`, but those tests assert on `start` — see note below).

> If `test/app/app.test.tsx`'s "typing a request and pressing enter calls controller.start" test now fails because input routes through `submit` (not `start`), update THAT test's spy to also implement `submit` and assert on `submit` instead — the behavior (Enter runs the request) is preserved, just via `submit`. Do not weaken it.

- [ ] **Step 6: Commit**

```bash
git add src/app/app.tsx test/app/app-nav.test.tsx test/app/app.test.tsx
git commit -m "feat: add list dashboard and /list /open navigation to the TUI"
```

---

## Task 4: Wire the lister + open into `launchTui`

**Files:**
- Modify: `src/cli/index.ts`
- Test: (covered by the existing `test/cli/index.tui.test.ts` credential-gate path; no new test needed — this is a one-line wiring change verified by typecheck + build)

The controller's `lister` must be wired to the real engine so `/list` shows real tasks.

- [ ] **Step 1: Edit `src/cli/index.ts`**

In `launchTui`, right after constructing the controller, wire the lister:
```typescript
  const controller = new TaskRunController(engine, new HeuristicRouter(), repoPath);
  controller.setLister(() => engine.listTasks());
```

- [ ] **Step 2: Verify**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck && bun run build && echo built`
Expected: all pass; typecheck clean; binary compiles. The existing `test/cli/index.tui.test.ts` (no-credential fast-exit) still passes.

- [ ] **Step 3: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: wire the task lister into the TUI launcher"
```

---

## Self-Review (completed during planning)

**Spec coverage (Plan 5b slice of §7.3 + §7.2):**
- `/list` dashboard showing each task's status · kind · phase · title (§7.3) → Tasks 2–3 ✓
- `/open <id>` and in-list selection (`↑/↓`, `enter`/`o`) to open a task into the run view (§7.3) → Tasks 2–3 ✓; `esc` back → Task 3 ✓
- Opening a `waiting_confirm` task lands on its gate (the run view's `a`/`r`/`s` then drive it via the existing `decide`) (§7.4) → Task 2 `loadTask`→`applyTask` sets state/message ✓
- The detected/assigned **kind** is shown per task in the list and via the run view's existing `detected: <kind>` feed line (§7.2 display) → Tasks 2–3 ✓
- Engine exposes tasks for the list (§6.2) → Task 1 `listTasks` ✓

**Intentionally deferred (not gaps):** the interactive **change-kind** at the first gate (§7.2's `[c]`) is deferred to v1.1 — in v1 `task` and `issue` run the identical workflow, so switching kind has no behavioral effect; the detected kind is already surfaced (feed + list). It lands with the debug workflow when changing kind actually reroutes. Per-token live streaming, multi-task concurrency, and the shared `buildRuntime` factory (dedup `run` vs `launchTui`) remain later/cleanup items. Opening a `running` task is not a v1 concern (the foreground model runs one task at a time; the list shows historical/paused tasks).

**Placeholder scan:** none — every code/test step is complete.

**Type consistency:** `ControllerView` gains `mode`/`tasks`/`selected` (Task 2), consumed by the App (Task 3) and defaulted in the initial view. `setLister`/`submit`/`openList`/`selectUp`/`selectDown`/`openSelected`/`openTask`/`backToPrompt`/`loadTask` are defined in Task 2 and used by Task 3's `AppProps` + key handlers and Task 4's wiring. `listTasks()` (Task 1) returns `Task[]` and is the lister source. `applyTask` (Plan 5a) is reused by `loadTask` for the status→message mapping. `TaskKind`/`TaskStatus`/`Phase` are the domain types rendered in the list rows.
