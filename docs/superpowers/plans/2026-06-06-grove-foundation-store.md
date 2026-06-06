# grove — Plan 1: Foundation & Store Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of the `grove` CLI — a Bun/TypeScript project with a swappable `Store` persistence layer (SQLite adapter), `~/.grove` paths + config, a `CommandRunner` wrapper, and a working `grove doctor` preflight command.

**Architecture:** Layered with interfaces at every boundary. The persistence layer is a `Store` interface implemented by `SqliteStore` (using Bun's built-in `bun:sqlite`), so a stronger DB can be swapped in later by writing one new adapter. External processes go through a `CommandRunner` interface so logic is testable without real `git`/`docker`. The CLI entry dispatches subcommands; this plan ships `--version` and `doctor`.

**Tech Stack:** Bun (runtime + test runner + bundler + `bun:sqlite`), TypeScript (strict), Node built-ins (`node:os`, `node:path`, `node:crypto`).

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | Project manifest, scripts, `bin` entry |
| `tsconfig.json` | Strict TypeScript config for Bun |
| `.gitignore` | Ignore `node_modules`, `dist`, local `.grove` |
| `src/domain/types.ts` | Core domain types & enums (`Task`, `PhaseRun`, `TaskEvent`, statuses, phases) |
| `src/domain/ids.ts` | Prefixed ID generation |
| `src/config/paths.ts` | Resolve `~/.grove` directory layout |
| `src/config/config.ts` | Load/save `GroveConfig` (disk thresholds) |
| `src/store/store.ts` | `Store` interface + input/patch types |
| `src/store/migrations.ts` | SQLite schema creation |
| `src/store/sqlite-store.ts` | `SqliteStore` adapter implementing `Store` |
| `src/infra/command-runner.ts` | `CommandRunner` interface + `BunCommandRunner` |
| `src/cli/doctor.ts` | `runDoctor` preflight logic (pure, takes a `CommandRunner`) |
| `src/cli/index.ts` | CLI entry: arg dispatch for `--version`, `doctor` |
| `test/**` | One test file per source module |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Test: `test/sanity.test.ts`

- [ ] **Step 1: Write the failing test**

`test/sanity.test.ts`:
```typescript
import { test, expect } from "bun:test";

test("bun test runs", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/sanity.test.ts`
Expected: FAIL — "Cannot find module" / no `bun-types`, or a TypeScript/config error because the project is not yet initialized.

- [ ] **Step 3: Create the project files**

`package.json`:
```json
{
  "name": "grove",
  "version": "0.0.1",
  "type": "module",
  "bin": { "grove": "./src/cli/index.ts" },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "build": "bun build ./src/cli/index.ts --compile --outfile dist/grove"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5"
  }
}
```

`tsconfig.json`:
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
    "verbatimModuleSyntax": true
  },
  "include": ["src", "test"]
}
```

`.gitignore`:
```
node_modules/
dist/
*.db
.grove/
```

- [ ] **Step 4: Install dev dependencies**

Run: `bun install`
Expected: creates `bun.lockb` and `node_modules/` with `@types/bun` and `typescript`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/sanity.test.ts`
Expected: PASS — 1 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore bun.lockb test/sanity.test.ts
git commit -m "chore: scaffold grove Bun/TS project"
```

---

## Task 2: Domain types & ID generation

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/ids.ts`
- Test: `test/domain/ids.test.ts`

- [ ] **Step 1: Write the failing test**

`test/domain/ids.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { newId } from "../../src/domain/ids.ts";

test("newId returns a prefixed id", () => {
  const id = newId("task");
  expect(id.startsWith("task_")).toBe(true);
  expect(id.length).toBeGreaterThan("task_".length);
});

test("newId returns unique ids", () => {
  const a = newId("task");
  const b = newId("task");
  expect(a).not.toBe(b);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/domain/ids.test.ts`
Expected: FAIL — "Cannot find module '../../src/domain/ids.ts'".

- [ ] **Step 3: Write the implementation**

`src/domain/types.ts`:
```typescript
export type TaskKind = "task" | "issue";

export type TaskStatus =
  | "running"
  | "waiting_confirm"
  | "blocked"
  | "done"
  | "stopped";

export type Phase = "brainstorm" | "plan" | "execute" | "review" | "finish";

export type PhaseState = "pending" | "running" | "succeeded" | "failed";

export interface Task {
  id: string;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  currentPhase: Phase;
  repoPath: string;
  worktreePath: string | null;
  branch: string | null;
  composeProject: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface PhaseRun {
  id: string;
  taskId: string;
  phase: Phase;
  state: PhaseState;
  summary: string | null;
  artifactPath: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  ts: string; // ISO 8601
  type: string;
  payload: string; // JSON-encoded string
}
```

`src/domain/ids.ts`:
```typescript
import { randomUUID } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/domain/ids.test.ts`
Expected: PASS — 2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts src/domain/ids.ts test/domain/ids.test.ts
git commit -m "feat: add domain types and id generator"
```

---

## Task 3: Paths resolver

**Files:**
- Create: `src/config/paths.ts`
- Test: `test/config/paths.test.ts`

- [ ] **Step 1: Write the failing test**

`test/config/paths.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { resolvePaths } from "../../src/config/paths.ts";

test("resolvePaths derives the grove layout from a root", () => {
  const p = resolvePaths("/tmp/groveroot");
  expect(p.root).toBe("/tmp/groveroot");
  expect(p.dbFile).toBe("/tmp/groveroot/grove.db");
  expect(p.tasksDir).toBe("/tmp/groveroot/tasks");
  expect(p.configFile).toBe("/tmp/groveroot/config.json");
  expect(p.taskDir("task_123")).toBe("/tmp/groveroot/tasks/task_123");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/config/paths.test.ts`
Expected: FAIL — "Cannot find module '../../src/config/paths.ts'".

- [ ] **Step 3: Write the implementation**

`src/config/paths.ts`:
```typescript
import { homedir } from "node:os";
import { join } from "node:path";

export interface GrovePaths {
  root: string;
  dbFile: string;
  tasksDir: string;
  configFile: string;
  taskDir(id: string): string;
}

export function resolvePaths(root: string = join(homedir(), ".grove")): GrovePaths {
  return {
    root,
    dbFile: join(root, "grove.db"),
    tasksDir: join(root, "tasks"),
    configFile: join(root, "config.json"),
    taskDir: (id: string) => join(root, "tasks", id),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/config/paths.test.ts`
Expected: PASS — 1 pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/paths.ts test/config/paths.test.ts
git commit -m "feat: add ~/.grove paths resolver"
```

---

## Task 4: Config loader

**Files:**
- Create: `src/config/config.ts`
- Test: `test/config/config.test.ts`

- [ ] **Step 1: Write the failing test**

`test/config/config.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePaths } from "../../src/config/paths.ts";
import { loadConfig, saveConfig, DEFAULT_CONFIG } from "../../src/config/config.ts";

function tempPaths() {
  return resolvePaths(mkdtempSync(join(tmpdir(), "grove-")));
}

test("loadConfig returns defaults when no file exists", async () => {
  const paths = tempPaths();
  const cfg = await loadConfig(paths);
  expect(cfg.disk.warnBytes).toBe(DEFAULT_CONFIG.disk.warnBytes);
  expect(cfg.disk.blockBytes).toBe(DEFAULT_CONFIG.disk.blockBytes);
});

test("saveConfig then loadConfig round-trips overrides", async () => {
  const paths = tempPaths();
  await saveConfig(paths, { disk: { warnBytes: 5, blockBytes: 1 } });
  const cfg = await loadConfig(paths);
  expect(cfg.disk.warnBytes).toBe(5);
  expect(cfg.disk.blockBytes).toBe(1);
});

test("loadConfig merges partial file over defaults", async () => {
  const paths = tempPaths();
  await Bun.write(paths.configFile, JSON.stringify({ disk: { warnBytes: 7 } }));
  const cfg = await loadConfig(paths);
  expect(cfg.disk.warnBytes).toBe(7);
  expect(cfg.disk.blockBytes).toBe(DEFAULT_CONFIG.disk.blockBytes);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/config/config.test.ts`
Expected: FAIL — "Cannot find module '../../src/config/config.ts'".

- [ ] **Step 3: Write the implementation**

`src/config/config.ts`:
```typescript
import type { GrovePaths } from "./paths.ts";

export interface GroveConfig {
  disk: {
    warnBytes: number;
    blockBytes: number;
  };
}

export const DEFAULT_CONFIG: GroveConfig = {
  disk: {
    warnBytes: 10 * 1024 ** 3, // 10 GB
    blockBytes: 2 * 1024 ** 3, //  2 GB
  },
};

export async function loadConfig(paths: GrovePaths): Promise<GroveConfig> {
  const file = Bun.file(paths.configFile);
  if (!(await file.exists())) return DEFAULT_CONFIG;
  const parsed = (await file.json()) as Partial<GroveConfig>;
  return {
    disk: { ...DEFAULT_CONFIG.disk, ...(parsed.disk ?? {}) },
  };
}

export async function saveConfig(paths: GrovePaths, config: GroveConfig): Promise<void> {
  await Bun.write(paths.configFile, JSON.stringify(config, null, 2));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/config/config.test.ts`
Expected: PASS — 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/config.ts test/config/config.test.ts
git commit -m "feat: add grove config loader with disk thresholds"
```

---

## Task 5: Store interface & migrations

**Files:**
- Create: `src/store/store.ts`
- Create: `src/store/migrations.ts`
- Test: `test/store/migrations.test.ts`

- [ ] **Step 1: Write the failing test**

`test/store/migrations.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "../../src/store/migrations.ts";

test("migrate creates tasks, phase_runs, events tables", () => {
  const db = new Database(":memory:");
  migrate(db);
  const names = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r: any) => r.name);
  expect(names).toContain("tasks");
  expect(names).toContain("phase_runs");
  expect(names).toContain("events");
});

test("migrate is idempotent", () => {
  const db = new Database(":memory:");
  migrate(db);
  expect(() => migrate(db)).not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/store/migrations.test.ts`
Expected: FAIL — "Cannot find module '../../src/store/migrations.ts'".

- [ ] **Step 3: Write the implementations**

`src/store/store.ts`:
```typescript
import type {
  Task,
  PhaseRun,
  TaskEvent,
  TaskKind,
  TaskStatus,
  Phase,
  PhaseState,
} from "../domain/types.ts";

export interface CreateTaskInput {
  title: string;
  kind: TaskKind;
  repoPath: string;
  status?: TaskStatus; // default "running"
  currentPhase?: Phase; // default "brainstorm"
}

export interface TaskPatch {
  status?: TaskStatus;
  currentPhase?: Phase;
  worktreePath?: string | null;
  branch?: string | null;
  composeProject?: string | null;
}

export interface TaskQuery {
  status?: TaskStatus;
}

export interface CreatePhaseRunInput {
  taskId: string;
  phase: Phase;
  state?: PhaseState; // default "pending"
}

export interface PhaseRunPatch {
  state?: PhaseState;
  summary?: string | null;
  artifactPath?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

export interface AppendEventInput {
  taskId: string;
  type: string;
  payload: unknown;
}

export interface Store {
  createTask(input: CreateTaskInput): Task;
  getTask(id: string): Task | null;
  queryTasks(query?: TaskQuery): Task[];
  updateTask(id: string, patch: TaskPatch): Task;

  createPhaseRun(input: CreatePhaseRunInput): PhaseRun;
  updatePhaseRun(id: string, patch: PhaseRunPatch): PhaseRun;
  getPhaseRuns(taskId: string): PhaseRun[];

  appendEvent(input: AppendEventInput): TaskEvent;
  getEvents(taskId: string): TaskEvent[];

  close(): void;
}
```

`src/store/migrations.ts`:
```typescript
import type { Database } from "bun:sqlite";

export function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      current_phase TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      worktree_path TEXT,
      branch TEXT,
      compose_project TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS phase_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      phase TEXT NOT NULL,
      state TEXT NOT NULL,
      summary TEXT,
      artifact_path TEXT,
      started_at TEXT,
      ended_at TEXT
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_phase_runs_task ON phase_runs(task_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/store/migrations.test.ts`
Expected: PASS — 2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/store.ts src/store/migrations.ts test/store/migrations.test.ts
git commit -m "feat: add Store interface and SQLite migrations"
```

---

## Task 6: SqliteStore — task CRUD

**Files:**
- Create: `src/store/sqlite-store.ts`
- Test: `test/store/sqlite-store.tasks.test.ts`

- [ ] **Step 1: Write the failing test**

`test/store/sqlite-store.tasks.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { SqliteStore } from "../../src/store/sqlite-store.ts";

function makeStore(now: () => string = () => "2026-06-06T00:00:00.000Z") {
  return SqliteStore.open(":memory:", { now });
}

test("createTask applies defaults and round-trips", () => {
  const store = makeStore();
  const task = store.createTask({ title: "add login", kind: "task", repoPath: "/repo" });
  expect(task.id.startsWith("task_")).toBe(true);
  expect(task.title).toBe("add login");
  expect(task.kind).toBe("task");
  expect(task.status).toBe("running");
  expect(task.currentPhase).toBe("brainstorm");
  expect(task.repoPath).toBe("/repo");
  expect(task.worktreePath).toBeNull();
  expect(task.createdAt).toBe("2026-06-06T00:00:00.000Z");
  expect(store.getTask(task.id)).toEqual(task);
  store.close();
});

test("getTask returns null for unknown id", () => {
  const store = makeStore();
  expect(store.getTask("task_nope")).toBeNull();
  store.close();
});

test("updateTask applies a patch and bumps updatedAt", () => {
  let t = 0;
  const store = makeStore(() => `2026-06-06T00:00:0${t++}.000Z`);
  const task = store.createTask({ title: "x", kind: "task", repoPath: "/repo" });
  const updated = store.updateTask(task.id, {
    status: "waiting_confirm",
    worktreePath: "/repo/.grove/wt",
    branch: "grove/abc",
  });
  expect(updated.status).toBe("waiting_confirm");
  expect(updated.worktreePath).toBe("/repo/.grove/wt");
  expect(updated.branch).toBe("grove/abc");
  expect(updated.updatedAt).not.toBe(task.updatedAt);
  expect(store.getTask(task.id)?.status).toBe("waiting_confirm");
  store.close();
});

test("updateTask throws for unknown id", () => {
  const store = makeStore();
  expect(() => store.updateTask("task_nope", { status: "done" })).toThrow();
  store.close();
});

test("queryTasks returns all, newest first, and filters by status", () => {
  let t = 0;
  const store = makeStore(() => `2026-06-06T00:00:0${t++}.000Z`);
  const a = store.createTask({ title: "a", kind: "task", repoPath: "/r" });
  const b = store.createTask({ title: "b", kind: "task", repoPath: "/r" });
  store.updateTask(a.id, { status: "done" });
  const all = store.queryTasks();
  expect(all.length).toBe(2);
  const done = store.queryTasks({ status: "done" });
  expect(done.length).toBe(1);
  expect(done[0]!.id).toBe(a.id);
  store.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/store/sqlite-store.tasks.test.ts`
Expected: FAIL — "Cannot find module '../../src/store/sqlite-store.ts'".

- [ ] **Step 3: Write the implementation**

`src/store/sqlite-store.ts`:
```typescript
import { Database } from "bun:sqlite";
import { migrate } from "./migrations.ts";
import { newId } from "../domain/ids.ts";
import type { Task, PhaseRun, TaskEvent } from "../domain/types.ts";
import type {
  Store,
  CreateTaskInput,
  TaskPatch,
  TaskQuery,
  CreatePhaseRunInput,
  PhaseRunPatch,
  AppendEventInput,
} from "./store.ts";

interface TaskRow {
  id: string;
  title: string;
  kind: string;
  status: string;
  current_phase: string;
  repo_path: string;
  worktree_path: string | null;
  branch: string | null;
  compose_project: string | null;
  created_at: string;
  updated_at: string;
}

function mapTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind as Task["kind"],
    status: r.status as Task["status"],
    currentPhase: r.current_phase as Task["currentPhase"],
    repoPath: r.repo_path,
    worktreePath: r.worktree_path,
    branch: r.branch,
    composeProject: r.compose_project,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface SqliteStoreOptions {
  now?: () => string;
}

export class SqliteStore implements Store {
  private db: Database;
  private now: () => string;

  constructor(db: Database, opts: SqliteStoreOptions = {}) {
    this.db = db;
    this.now = opts.now ?? (() => new Date().toISOString());
    migrate(db);
  }

  static open(file: string, opts: SqliteStoreOptions = {}): SqliteStore {
    return new SqliteStore(new Database(file), opts);
  }

  createTask(input: CreateTaskInput): Task {
    const id = newId("task");
    const ts = this.now();
    this.db
      .query(
        `INSERT INTO tasks
         (id, title, kind, status, current_phase, repo_path, worktree_path, branch, compose_project, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.kind,
        input.status ?? "running",
        input.currentPhase ?? "brainstorm",
        input.repoPath,
        null,
        null,
        null,
        ts,
        ts,
      );
    return this.getTask(id)!;
  }

  getTask(id: string): Task | null {
    const row = this.db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null;
    return row ? mapTask(row) : null;
  }

  queryTasks(query: TaskQuery = {}): Task[] {
    const rows = query.status
      ? (this.db
          .query("SELECT * FROM tasks WHERE status = ? ORDER BY updated_at DESC")
          .all(query.status) as TaskRow[])
      : (this.db.query("SELECT * FROM tasks ORDER BY updated_at DESC").all() as TaskRow[]);
    return rows.map(mapTask);
  }

  updateTask(id: string, patch: TaskPatch): Task {
    const cur = this.getTask(id);
    if (!cur) throw new Error(`task not found: ${id}`);
    const next: Task = { ...cur, ...patch, updatedAt: this.now() };
    this.db
      .query(
        `UPDATE tasks SET status = ?, current_phase = ?, worktree_path = ?, branch = ?, compose_project = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        next.status,
        next.currentPhase,
        next.worktreePath,
        next.branch,
        next.composeProject,
        next.updatedAt,
        id,
      );
    return next;
  }

  // --- phase_runs and events implemented in Tasks 7 & 8 ---
  createPhaseRun(_input: CreatePhaseRunInput): PhaseRun {
    throw new Error("not implemented");
  }
  updatePhaseRun(_id: string, _patch: PhaseRunPatch): PhaseRun {
    throw new Error("not implemented");
  }
  getPhaseRuns(_taskId: string): PhaseRun[] {
    throw new Error("not implemented");
  }
  appendEvent(_input: AppendEventInput): TaskEvent {
    throw new Error("not implemented");
  }
  getEvents(_taskId: string): TaskEvent[] {
    throw new Error("not implemented");
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/store/sqlite-store.tasks.test.ts`
Expected: PASS — 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/sqlite-store.ts test/store/sqlite-store.tasks.test.ts
git commit -m "feat: implement SqliteStore task CRUD"
```

---

## Task 7: SqliteStore — phase runs

**Files:**
- Modify: `src/store/sqlite-store.ts` (replace the `createPhaseRun`/`updatePhaseRun`/`getPhaseRuns` stubs)
- Test: `test/store/sqlite-store.phaseruns.test.ts`

- [ ] **Step 1: Write the failing test**

`test/store/sqlite-store.phaseruns.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { SqliteStore } from "../../src/store/sqlite-store.ts";

function makeStore() {
  return SqliteStore.open(":memory:", { now: () => "2026-06-06T00:00:00.000Z" });
}

test("createPhaseRun defaults state to pending and round-trips", () => {
  const store = makeStore();
  const task = store.createTask({ title: "x", kind: "task", repoPath: "/r" });
  const run = store.createPhaseRun({ taskId: task.id, phase: "brainstorm" });
  expect(run.id.startsWith("run_")).toBe(true);
  expect(run.taskId).toBe(task.id);
  expect(run.phase).toBe("brainstorm");
  expect(run.state).toBe("pending");
  expect(run.summary).toBeNull();
  store.close();
});

test("updatePhaseRun applies a patch", () => {
  const store = makeStore();
  const task = store.createTask({ title: "x", kind: "task", repoPath: "/r" });
  const run = store.createPhaseRun({ taskId: task.id, phase: "brainstorm" });
  const updated = store.updatePhaseRun(run.id, {
    state: "succeeded",
    summary: "design done",
    artifactPath: "/r/design.md",
    endedAt: "2026-06-06T01:00:00.000Z",
  });
  expect(updated.state).toBe("succeeded");
  expect(updated.summary).toBe("design done");
  expect(updated.artifactPath).toBe("/r/design.md");
  expect(updated.endedAt).toBe("2026-06-06T01:00:00.000Z");
  store.close();
});

test("updatePhaseRun throws for unknown id", () => {
  const store = makeStore();
  expect(() => store.updatePhaseRun("run_nope", { state: "failed" })).toThrow();
  store.close();
});

test("getPhaseRuns returns runs for a task in creation order", () => {
  const store = makeStore();
  const task = store.createTask({ title: "x", kind: "task", repoPath: "/r" });
  store.createPhaseRun({ taskId: task.id, phase: "brainstorm" });
  store.createPhaseRun({ taskId: task.id, phase: "plan" });
  const runs = store.getPhaseRuns(task.id);
  expect(runs.length).toBe(2);
  expect(runs[0]!.phase).toBe("brainstorm");
  expect(runs[1]!.phase).toBe("plan");
  store.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/store/sqlite-store.phaseruns.test.ts`
Expected: FAIL — throws "not implemented".

- [ ] **Step 3: Replace the phase-run stubs in `src/store/sqlite-store.ts`**

First add this row type + mapper near the top, after `mapTask`:
```typescript
interface PhaseRunRow {
  id: string;
  task_id: string;
  phase: string;
  state: string;
  summary: string | null;
  artifact_path: string | null;
  started_at: string | null;
  ended_at: string | null;
}

function mapPhaseRun(r: PhaseRunRow): PhaseRun {
  return {
    id: r.id,
    taskId: r.task_id,
    phase: r.phase as PhaseRun["phase"],
    state: r.state as PhaseRun["state"],
    summary: r.summary,
    artifactPath: r.artifact_path,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}
```

Then replace the three stub methods with:
```typescript
  createPhaseRun(input: CreatePhaseRunInput): PhaseRun {
    const id = newId("run");
    this.db
      .query(
        `INSERT INTO phase_runs (id, task_id, phase, state, summary, artifact_path, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.taskId, input.phase, input.state ?? "pending", null, null, null, null);
    const row = this.db.query("SELECT * FROM phase_runs WHERE id = ?").get(id) as PhaseRunRow;
    return mapPhaseRun(row);
  }

  updatePhaseRun(id: string, patch: PhaseRunPatch): PhaseRun {
    const row = this.db.query("SELECT * FROM phase_runs WHERE id = ?").get(id) as PhaseRunRow | null;
    if (!row) throw new Error(`phase run not found: ${id}`);
    const cur = mapPhaseRun(row);
    const next: PhaseRun = { ...cur, ...patch };
    this.db
      .query(
        `UPDATE phase_runs SET state = ?, summary = ?, artifact_path = ?, started_at = ?, ended_at = ? WHERE id = ?`,
      )
      .run(next.state, next.summary, next.artifactPath, next.startedAt, next.endedAt, id);
    return next;
  }

  getPhaseRuns(taskId: string): PhaseRun[] {
    const rows = this.db
      .query("SELECT * FROM phase_runs WHERE task_id = ? ORDER BY rowid ASC")
      .all(taskId) as PhaseRunRow[];
    return rows.map(mapPhaseRun);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/store/sqlite-store.phaseruns.test.ts`
Expected: PASS — 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/sqlite-store.ts test/store/sqlite-store.phaseruns.test.ts
git commit -m "feat: implement SqliteStore phase runs"
```

---

## Task 8: SqliteStore — events

**Files:**
- Modify: `src/store/sqlite-store.ts` (replace the `appendEvent`/`getEvents` stubs)
- Test: `test/store/sqlite-store.events.test.ts`

- [ ] **Step 1: Write the failing test**

`test/store/sqlite-store.events.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { SqliteStore } from "../../src/store/sqlite-store.ts";

function makeStore() {
  return SqliteStore.open(":memory:", { now: () => "2026-06-06T00:00:00.000Z" });
}

test("appendEvent stores JSON payload and returns the event", () => {
  const store = makeStore();
  const task = store.createTask({ title: "x", kind: "task", repoPath: "/r" });
  const evt = store.appendEvent({ taskId: task.id, type: "phase_started", payload: { phase: "brainstorm" } });
  expect(evt.id.startsWith("evt_")).toBe(true);
  expect(evt.taskId).toBe(task.id);
  expect(evt.type).toBe("phase_started");
  expect(JSON.parse(evt.payload)).toEqual({ phase: "brainstorm" });
  store.close();
});

test("getEvents returns events for a task in append order", () => {
  const store = makeStore();
  const task = store.createTask({ title: "x", kind: "task", repoPath: "/r" });
  store.appendEvent({ taskId: task.id, type: "a", payload: 1 });
  store.appendEvent({ taskId: task.id, type: "b", payload: 2 });
  const events = store.getEvents(task.id);
  expect(events.length).toBe(2);
  expect(events[0]!.type).toBe("a");
  expect(events[1]!.type).toBe("b");
  store.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/store/sqlite-store.events.test.ts`
Expected: FAIL — throws "not implemented".

- [ ] **Step 3: Replace the event stubs in `src/store/sqlite-store.ts`**

```typescript
  appendEvent(input: AppendEventInput): TaskEvent {
    const id = newId("evt");
    const ts = this.now();
    const payload = JSON.stringify(input.payload);
    this.db
      .query("INSERT INTO events (id, task_id, ts, type, payload) VALUES (?, ?, ?, ?, ?)")
      .run(id, input.taskId, ts, input.type, payload);
    return { id, taskId: input.taskId, ts, type: input.type, payload };
  }

  getEvents(taskId: string): TaskEvent[] {
    const rows = this.db
      .query("SELECT * FROM events WHERE task_id = ? ORDER BY rowid ASC")
      .all(taskId) as Array<{ id: string; task_id: string; ts: string; type: string; payload: string }>;
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      ts: r.ts,
      type: r.type,
      payload: r.payload,
    }));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/store/sqlite-store.events.test.ts`
Expected: PASS — 2 pass.

- [ ] **Step 5: Run the full store suite + typecheck**

Run: `bun test test/store && bun run typecheck`
Expected: all store tests PASS; `tsc --noEmit` reports no errors.

- [ ] **Step 6: Commit**

```bash
git add src/store/sqlite-store.ts test/store/sqlite-store.events.test.ts
git commit -m "feat: implement SqliteStore events; complete Store adapter"
```

---

## Task 9: CommandRunner

**Files:**
- Create: `src/infra/command-runner.ts`
- Test: `test/infra/command-runner.test.ts`

- [ ] **Step 1: Write the failing test**

`test/infra/command-runner.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { BunCommandRunner } from "../../src/infra/command-runner.ts";

test("BunCommandRunner runs a real command and captures stdout + exit code", async () => {
  const runner = new BunCommandRunner();
  const res = await runner.run("echo", ["hello"]);
  expect(res.code).toBe(0);
  expect(res.stdout.trim()).toBe("hello");
});

test("BunCommandRunner returns code 127 when the command is missing", async () => {
  const runner = new BunCommandRunner();
  const res = await runner.run("definitely-not-a-real-binary-xyz", []);
  expect(res.code).toBe(127);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/infra/command-runner.test.ts`
Expected: FAIL — "Cannot find module '../../src/infra/command-runner.ts'".

- [ ] **Step 3: Write the implementation**

`src/infra/command-runner.ts`:
```typescript
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(cmd: string, args: string[]): Promise<CommandResult>;
}

export class BunCommandRunner implements CommandRunner {
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    try {
      const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const code = await proc.exited;
      return { code, stdout, stderr };
    } catch {
      // Binary not found / not executable.
      return { code: 127, stdout: "", stderr: `command not found: ${cmd}` };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/infra/command-runner.test.ts`
Expected: PASS — 2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/infra/command-runner.ts test/infra/command-runner.test.ts
git commit -m "feat: add CommandRunner abstraction"
```

---

## Task 10: Doctor preflight logic

**Files:**
- Create: `src/cli/doctor.ts`
- Test: `test/cli/doctor.test.ts`

- [ ] **Step 1: Write the failing test**

`test/cli/doctor.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { runDoctor } from "../../src/cli/doctor.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class FakeRunner implements CommandRunner {
  constructor(private map: Record<string, CommandResult>) {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    const key = [cmd, ...args].join(" ");
    return this.map[key] ?? { code: 127, stdout: "", stderr: "not found" };
  }
}

const OK = (stdout: string): CommandResult => ({ code: 0, stdout, stderr: "" });

test("runDoctor reports ok when all dependencies are present", async () => {
  const runner = new FakeRunner({
    "git --version": OK("git version 2.45.0"),
    "docker --version": OK("Docker version 27.0.0"),
    "docker compose version": OK("Docker Compose version v2.29.0"),
  });
  const report = await runDoctor(runner);
  expect(report.ok).toBe(true);
  expect(report.checks.length).toBe(3);
  expect(report.checks.every((c) => c.ok)).toBe(true);
  const git = report.checks.find((c) => c.name === "git")!;
  expect(git.detail).toBe("git version 2.45.0");
});

test("runDoctor reports not-ok when docker is missing", async () => {
  const runner = new FakeRunner({
    "git --version": OK("git version 2.45.0"),
    // docker + compose missing -> default 127
  });
  const report = await runDoctor(runner);
  expect(report.ok).toBe(false);
  const docker = report.checks.find((c) => c.name === "docker")!;
  expect(docker.ok).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/cli/doctor.test.ts`
Expected: FAIL — "Cannot find module '../../src/cli/doctor.ts'".

- [ ] **Step 3: Write the implementation**

`src/cli/doctor.ts`:
```typescript
import type { CommandRunner } from "../infra/command-runner.ts";

export interface DependencyCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  checks: DependencyCheck[];
  ok: boolean;
}

interface Dependency {
  name: string;
  cmd: string;
  args: string[];
}

const REQUIRED: Dependency[] = [
  { name: "git", cmd: "git", args: ["--version"] },
  { name: "docker", cmd: "docker", args: ["--version"] },
  { name: "docker compose", cmd: "docker", args: ["compose", "version"] },
];

export async function runDoctor(runner: CommandRunner): Promise<DoctorReport> {
  const checks: DependencyCheck[] = [];
  for (const dep of REQUIRED) {
    const res = await runner.run(dep.cmd, dep.args);
    if (res.code === 0) {
      checks.push({ name: dep.name, ok: true, detail: res.stdout.trim() });
    } else {
      checks.push({
        name: dep.name,
        ok: false,
        detail: `not found or failed (exit ${res.code})`,
      });
    }
  }
  return { checks, ok: checks.every((c) => c.ok) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/cli/doctor.test.ts`
Expected: PASS — 2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/doctor.ts test/cli/doctor.test.ts
git commit -m "feat: add doctor preflight logic"
```

---

## Task 11: CLI entry & wiring

**Files:**
- Create: `src/cli/index.ts`
- Test: `test/cli/index.test.ts`

- [ ] **Step 1: Write the failing test**

`test/cli/index.test.ts` (drives the compiled-by-Bun entry as a subprocess so we test the real CLI surface):
```typescript
import { test, expect } from "bun:test";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "..", "..", "src", "cli", "index.ts");

async function runCli(args: string[]) {
  const proc = Bun.spawn(["bun", ENTRY, ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

test("--version prints the version and exits 0", async () => {
  const { code, stdout } = await runCli(["--version"]);
  expect(code).toBe(0);
  expect(stdout.trim()).toBe("0.0.1");
});

test("doctor runs and exits (0 or 1) with per-dependency lines", async () => {
  const { code, stdout } = await runCli(["doctor"]);
  expect([0, 1]).toContain(code);
  expect(stdout).toContain("git");
  expect(stdout).toContain("docker");
});

test("no args prints usage", async () => {
  const { code, stdout } = await runCli([]);
  expect(code).toBe(0);
  expect(stdout.toLowerCase()).toContain("usage");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/cli/index.test.ts`
Expected: FAIL — entry module does not exist, subprocess errors / non-zero exit.

- [ ] **Step 3: Write the implementation**

`src/cli/index.ts`:
```typescript
#!/usr/bin/env bun
import { runDoctor } from "./doctor.ts";
import { BunCommandRunner } from "../infra/command-runner.ts";

const VERSION = "0.0.1";

function printUsage(): void {
  console.log("grove — usage: grove [doctor | --version]");
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[2];
  switch (cmd) {
    case "-v":
    case "--version":
      console.log(VERSION);
      return 0;
    case "doctor": {
      const report = await runDoctor(new BunCommandRunner());
      for (const c of report.checks) {
        console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
      }
      console.log(report.ok ? "\nAll good." : "\nMissing dependencies — see above.");
      return report.ok ? 0 : 1;
    }
    default:
      printUsage();
      return 0;
  }
}

main(process.argv).then((code) => process.exit(code));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/cli/index.test.ts`
Expected: PASS — 3 pass.

- [ ] **Step 5: Run the full suite, typecheck, and a build smoke test**

Run: `bun test && bun run typecheck && bun run build && ./dist/grove --version`
Expected: all tests PASS; `tsc --noEmit` clean; `dist/grove` binary produced; prints `0.0.1`.

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts test/cli/index.test.ts
git commit -m "feat: add CLI entry with --version and doctor"
```

---

## Self-Review (completed during planning)

**Spec coverage (Plan 1 slice):**
- `Store` interface + `SqliteStore` (spec §4.1) → Tasks 5–8 ✓
- `~/.grove` paths + config with disk thresholds (spec §4.2, §8.2) → Tasks 3–4 ✓
- `CommandRunner` typed wrapper (spec §5.2 "typed wrapper", reused by doctor + future infra) → Task 9 ✓
- `grove doctor` preflight (spec §9 "Preflight") → Tasks 10–11 ✓
- Domain types/statuses/phases (spec §4.2, §4.3) → Task 2 ✓
- Bun/TS single-binary build (spec §2) → Tasks 1 & 11 (build smoke) ✓

**Deferred to later plans (intentional, not gaps):** WorktreeManager/ComposeManager/InfraManager/DiskMonitor (Plan 2), AgentRunner (Plan 3), Task engine state machine + gates + resume (Plan 4), Ink TUI/menu/list (Plan 5), `init` and `grove gc` commands (Plan 2, alongside infra). The `Store` is built complete now so later plans consume a stable interface.

**Placeholder scan:** none — every code/test step contains complete content.

**Type consistency:** `Store` method names and the `Task`/`PhaseRun`/`TaskEvent` shapes are defined once in Tasks 2 & 5 and used unchanged in Tasks 6–8 and 10–11. ID prefixes: `task_` (Task 6), `run_` (Task 7), `evt_` (Task 8) — consistent with their tests.
