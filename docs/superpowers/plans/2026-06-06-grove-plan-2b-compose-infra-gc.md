# grove — Plan 2b: Services, Lifecycle Facade & GC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete grove's infra layer — a `DockerRunner` wrapper, a `ComposeManager` (isolated per-task service stacks via Compose project `grove-<id>`), an `InfraManager` facade (provision = worktree+compose up, teardown = compose down+worktree remove), and a conservative Store-reconciled `grove gc` that reclaims only grove-owned orphans.

**Architecture:** Mirrors Plan 2a — each unit is an interface with an adapter that shells out through the Plan 1 `CommandRunner`, so all logic is unit-testable with a fake runner. No host-port publishing in v1 (services talk over the Compose project network). `InfraManager` composes `WorktreeManager` + `ComposeManager`. `grove gc` reconciles the `Store` (source of truth for live tasks) against on-disk worktrees and `grove-`-prefixed Compose projects, and only reclaims resources whose task is absent or in a terminal state — never a global `docker system prune`.

**Tech Stack:** Bun (`bun test`, `bun:sqlite`), TypeScript (strict). Plan 1 + 2a modules: `CommandRunner`, `Store`/`SqliteStore`, `GrovePaths`/`resolvePaths`, `WorktreeManager`/`GitWorktreeManager`, `GitRunner`.

---

## Context for the implementer (read once)

Plans 1 + 2a are merged on `main`. Available:
- `src/infra/command-runner.ts` — `CommandRunner { run(cmd, args): Promise<CommandResult> }`, `CommandResult { code, stdout, stderr }`, `BunCommandRunner`.
- `src/infra/worktree-manager.ts` — `WorktreeManager` (`create(taskId,title)→Worktree{taskId,worktreePath,branch}`, `remove`, `list`, `getDiff`), `GitWorktreeManager(git, paths)`.
- `src/infra/git-runner.ts` — `GitRunner`.
- `src/config/paths.ts` — `resolvePaths(root?)→GrovePaths{ root, dbFile, tasksDir, configFile, taskDir(id) }` (root is normalized absolute).
- `src/store/*` — `Store` (incl. `queryTasks(query?)`, `getTask(id)`, `updateTask`), `SqliteStore.open(file, opts?)`, domain `Task { id, status, ... }`, `TaskStatus = "running"|"waiting_confirm"|"blocked"|"done"|"stopped"`.
- `src/cli/index.ts` — CLI dispatch (`init`/`doctor`/`--version`) with a `grovePaths()` helper honoring `GROVE_HOME`.

**Environment quirk:** bun is at `~/.bun/bin/bun`, NOT on PATH. Prepend `export PATH="$HOME/.bun/bin:$PATH";` to every bun command (state does not persist between calls). Verify: `export PATH="$HOME/.bun/bin:$PATH"; bun --version` → `1.3.14`.

Imports use explicit `.ts` extensions. TDD throughout. One logical change per commit.

**Design decisions locked in brainstorming:**
- **No host-port publishing in v1.** `ComposeManager` runs `docker compose up -d` for project `grove-<taskId>`; services use the Compose network. No port allocation/remapping (a `PortAllocator` is deferred).
- **Compose project name = `grove-<taskId>`** (taskId is lowercase `task_<hex-uuid>`, a valid Compose project name). Unambiguous: strip the `grove-` prefix to recover the taskId.
- **No compose file in the worktree → up/down are no-ops** (worktree-only task; not an error). Detected file names (first match wins): `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`.
- **`grove gc` is conservative + Store-reconciled:** reclaims a worktree dir / `grove-<id>` Compose project ONLY when its task is absent from the Store or in a terminal state (`done`/`stopped`). Never touches `running`/`waiting_confirm`/`blocked` tasks. Lists what it will remove and confirms unless `--yes`. Strictly scoped to `grove-`/`~/.grove/tasks/` ownership — never a global prune.
- **Disk-gating stays with the engine (Plan 4)** — `InfraManager` does not consult `DiskMonitor` here.
- **Real-Docker integration test is gated behind `GROVE_DOCKER_TESTS=1`** so the default suite needs no Docker.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/infra/docker-runner.ts` | `DockerRunner` — typed wrapper over `CommandRunner` for `docker` / `docker compose` invocations |
| `src/infra/compose-file.ts` | `findComposeFile(dir)` — locate a compose file in a worktree (or null) |
| `src/infra/compose-manager.ts` | `ComposeManager` interface + `DockerComposeManager` adapter (up/down/status/logs, no-op when no compose file) |
| `src/infra/infra-manager.ts` | `InfraManager` facade — `provision`/`teardown` composing worktree + compose |
| `src/cli/gc.ts` | `findOrphans` + `runGc` — Store-reconciled reclamation logic |
| `src/cli/index.ts` | (modify) add `gc` subcommand dispatch (`--yes`) |
| `test/infra/*`, `test/cli/gc.test.ts`, `test/cli/index.gc.test.ts` | one test file per module |

---

## Task 1: DockerRunner wrapper

**Files:**
- Create: `src/infra/docker-runner.ts`
- Test: `test/infra/docker-runner.test.ts`

A thin typed wrapper over `CommandRunner` for docker commands. `docker(args)` runs `docker ...` and throws on non-zero exit; `compose(project, args)` runs `docker compose -p <project> ...`.

- [ ] **Step 1: Write the failing test**

`test/infra/docker-runner.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { DockerRunner } from "../../src/infra/docker-runner.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class RecordingRunner implements CommandRunner {
  calls: Array<{ cmd: string; args: string[] }> = [];
  constructor(private result: CommandResult) {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    this.calls.push({ cmd, args });
    return this.result;
  }
}

test("docker() runs docker with args and returns trimmed stdout", async () => {
  const runner = new RecordingRunner({ code: 0, stdout: "out\n", stderr: "" });
  const docker = new DockerRunner(runner);
  const out = await docker.docker(["ps", "-a"]);
  expect(out).toBe("out");
  expect(runner.calls[0]).toEqual({ cmd: "docker", args: ["ps", "-a"] });
});

test("docker() throws with stderr on non-zero exit", async () => {
  const runner = new RecordingRunner({ code: 1, stdout: "", stderr: "boom" });
  const docker = new DockerRunner(runner);
  await expect(docker.docker(["ps"])).rejects.toThrow("boom");
});

test("compose() prepends 'compose -p <project>' to the args", async () => {
  const runner = new RecordingRunner({ code: 0, stdout: "", stderr: "" });
  const docker = new DockerRunner(runner);
  await docker.compose("grove-task_1", ["up", "-d"]);
  expect(runner.calls[0]).toEqual({
    cmd: "docker",
    args: ["compose", "-p", "grove-task_1", "up", "-d"],
  });
});

test("composeOk() returns false on non-zero exit instead of throwing", async () => {
  const runner = new RecordingRunner({ code: 1, stdout: "", stderr: "no such project" });
  const docker = new DockerRunner(runner);
  expect(await docker.composeOk("grove-task_1", ["down"])).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/docker-runner.test.ts`
Expected: FAIL — "Cannot find module '../../src/infra/docker-runner.ts'".

- [ ] **Step 3: Write the implementation**

`src/infra/docker-runner.ts`:
```typescript
import type { CommandRunner } from "./command-runner.ts";

export class DockerRunner {
  constructor(private runner: CommandRunner) {}

  /** Run `docker <args>`; returns trimmed stdout, throws on non-zero exit. */
  async docker(args: string[]): Promise<string> {
    const res = await this.runner.run("docker", args);
    if (res.code !== 0) {
      throw new Error(`docker ${args.join(" ")} failed (exit ${res.code}): ${res.stderr.trim()}`);
    }
    return res.stdout.trim();
  }

  /** Run `docker compose -p <project> <args>`; returns trimmed stdout, throws on non-zero exit. */
  async compose(project: string, args: string[]): Promise<string> {
    return this.docker(["compose", "-p", project, ...args]);
  }

  /** Like compose() but returns false on non-zero exit instead of throwing (for best-effort teardown). */
  async composeOk(project: string, args: string[]): Promise<boolean> {
    const res = await this.runner.run("docker", ["compose", "-p", project, ...args]);
    return res.code === 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/docker-runner.test.ts`
Expected: PASS — 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/infra/docker-runner.ts test/infra/docker-runner.test.ts
git commit -m "feat: add DockerRunner typed wrapper over CommandRunner"
```

---

## Task 2: Compose file detection

**Files:**
- Create: `src/infra/compose-file.ts`
- Test: `test/infra/compose-file.test.ts`

- [ ] **Step 1: Write the failing test**

`test/infra/compose-file.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findComposeFile } from "../../src/infra/compose-file.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "grove-cf-"));
}

test("findComposeFile returns null when no compose file exists", () => {
  const dir = tempDir();
  try {
    expect(findComposeFile(dir)).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findComposeFile finds docker-compose.yml", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "docker-compose.yml"), "services: {}\n");
    expect(findComposeFile(dir)).toBe(join(dir, "docker-compose.yml"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findComposeFile prefers docker-compose.yml over compose.yaml", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "compose.yaml"), "services: {}\n");
    writeFileSync(join(dir, "docker-compose.yml"), "services: {}\n");
    expect(findComposeFile(dir)).toBe(join(dir, "docker-compose.yml"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findComposeFile finds compose.yaml when it is the only one", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "compose.yaml"), "services: {}\n");
    expect(findComposeFile(dir)).toBe(join(dir, "compose.yaml"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/compose-file.test.ts`
Expected: FAIL — "Cannot find module '../../src/infra/compose-file.ts'".

- [ ] **Step 3: Write the implementation**

`src/infra/compose-file.ts`:
```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";

// Standard Compose filenames, in precedence order (Docker's own preference).
const COMPOSE_FILENAMES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
];

/** Return the absolute path of the first compose file found in `dir`, or null if none. */
export function findComposeFile(dir: string): string | null {
  for (const name of COMPOSE_FILENAMES) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/compose-file.test.ts`
Expected: PASS — 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/infra/compose-file.ts test/infra/compose-file.test.ts
git commit -m "feat: add compose-file detection helper"
```

---

## Task 3: ComposeManager — up / down (with no-op when no compose file)

**Files:**
- Create: `src/infra/compose-manager.ts`
- Test: `test/infra/compose-manager.test.ts`

`up`/`down` operate on a task's worktree. They detect a compose file; if none, they no-op and report `false`. The Compose project is `grove-<taskId>`.

- [ ] **Step 1: Write the failing test**

`test/infra/compose-manager.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerComposeManager, composeProjectFor } from "../../src/infra/compose-manager.ts";
import { DockerRunner } from "../../src/infra/docker-runner.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class ScriptedRunner implements CommandRunner {
  calls: string[][] = [];
  constructor(private result: CommandResult = { code: 0, stdout: "", stderr: "" }) {}
  async run(_cmd: string, args: string[]): Promise<CommandResult> {
    this.calls.push(args);
    return this.result;
  }
}

function worktreeWithCompose(): string {
  const dir = mkdtempSync(join(tmpdir(), "grove-wt-"));
  writeFileSync(join(dir, "docker-compose.yml"), "services:\n  web:\n    image: nginx\n");
  return dir;
}

test("composeProjectFor builds grove-<taskId>", () => {
  expect(composeProjectFor("task_abc123")).toBe("grove-task_abc123");
});

test("up() runs docker compose up -d with the project and compose file; returns true", async () => {
  const wt = worktreeWithCompose();
  try {
    const runner = new ScriptedRunner();
    const mgr = new DockerComposeManager(new DockerRunner(runner));
    const started = await mgr.up("task_abc123", wt);
    expect(started).toBe(true);
    const call = runner.calls[0]!;
    expect(call.slice(0, 5)).toEqual(["compose", "-p", "grove-task_abc123", "-f", join(wt, "docker-compose.yml")]);
    expect(call).toContain("up");
    expect(call).toContain("-d");
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test("up() is a no-op returning false when the worktree has no compose file", async () => {
  const wt = mkdtempSync(join(tmpdir(), "grove-wt-"));
  try {
    const runner = new ScriptedRunner();
    const mgr = new DockerComposeManager(new DockerRunner(runner));
    const started = await mgr.up("task_abc123", wt);
    expect(started).toBe(false);
    expect(runner.calls.length).toBe(0);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test("down() runs compose down --volumes --remove-orphans; returns true", async () => {
  const wt = worktreeWithCompose();
  try {
    const runner = new ScriptedRunner();
    const mgr = new DockerComposeManager(new DockerRunner(runner));
    const stopped = await mgr.down("task_abc123", wt);
    expect(stopped).toBe(true);
    const call = runner.calls[0]!;
    expect(call.slice(0, 3)).toEqual(["compose", "-p", "grove-task_abc123"]);
    expect(call).toContain("down");
    expect(call).toContain("--volumes");
    expect(call).toContain("--remove-orphans");
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test("down() is a no-op returning false when the worktree has no compose file", async () => {
  const wt = mkdtempSync(join(tmpdir(), "grove-wt-"));
  try {
    const runner = new ScriptedRunner();
    const mgr = new DockerComposeManager(new DockerRunner(runner));
    expect(await mgr.down("task_abc123", wt)).toBe(false);
    expect(runner.calls.length).toBe(0);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/compose-manager.test.ts`
Expected: FAIL — "Cannot find module '../../src/infra/compose-manager.ts'".

- [ ] **Step 3: Write the implementation**

`src/infra/compose-manager.ts`:
```typescript
import type { DockerRunner } from "./docker-runner.ts";
import { findComposeFile } from "./compose-file.ts";

export function composeProjectFor(taskId: string): string {
  return `grove-${taskId}`;
}

export interface ComposeManager {
  /** Start the task's service stack. Returns false (no-op) if the worktree has no compose file. */
  up(taskId: string, worktreePath: string): Promise<boolean>;
  /** Stop + remove the task's service stack (containers, volumes, orphans). No-op false if no compose file. */
  down(taskId: string, worktreePath: string): Promise<boolean>;
  /** Stop a project by name only (used by gc when the worktree/compose file is already gone). */
  downByProject(project: string): Promise<boolean>;
  /** `docker compose ps` output for the task, or "" if no compose file. */
  status(taskId: string, worktreePath: string): Promise<string>;
  /** `docker compose logs` output for the task, or "" if no compose file. */
  logs(taskId: string, worktreePath: string): Promise<string>;
}

export class DockerComposeManager implements ComposeManager {
  constructor(private docker: DockerRunner) {}

  async up(taskId: string, worktreePath: string): Promise<boolean> {
    const file = findComposeFile(worktreePath);
    if (!file) return false;
    await this.docker.compose(composeProjectFor(taskId), ["-f", file, "up", "-d"]);
    return true;
  }

  async down(taskId: string, worktreePath: string): Promise<boolean> {
    const file = findComposeFile(worktreePath);
    if (!file) return false;
    await this.docker.compose(composeProjectFor(taskId), [
      "-f",
      file,
      "down",
      "--volumes",
      "--remove-orphans",
    ]);
    return true;
  }

  async downByProject(project: string): Promise<boolean> {
    // No -f: compose removes resources by project label even without the file.
    return this.docker.composeOk(project, ["down", "--volumes", "--remove-orphans"]);
  }

  async status(taskId: string, worktreePath: string): Promise<string> {
    const file = findComposeFile(worktreePath);
    if (!file) return "";
    return this.docker.compose(composeProjectFor(taskId), ["-f", file, "ps"]);
  }

  async logs(taskId: string, worktreePath: string): Promise<string> {
    const file = findComposeFile(worktreePath);
    if (!file) return "";
    return this.docker.compose(composeProjectFor(taskId), ["-f", file, "logs", "--no-color"]);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/compose-manager.test.ts`
Expected: PASS — 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/infra/compose-manager.ts test/infra/compose-manager.test.ts
git commit -m "feat: add ComposeManager up/down with no-compose-file no-op"
```

---

## Task 4: ComposeManager — status / logs / downByProject tests

**Files:**
- Modify: `test/infra/compose-manager.test.ts` (append tests; implementation already written in Task 3)

- [ ] **Step 1: Write the failing tests**

Append to `test/infra/compose-manager.test.ts`:
```typescript
test("status() returns ps output and no-op '' when no compose file", async () => {
  const wt = worktreeWithCompose();
  const empty = mkdtempSync(join(tmpdir(), "grove-wt-"));
  try {
    const runner = new ScriptedRunner({ code: 0, stdout: "NAME  STATE\nweb  running\n", stderr: "" });
    const mgr = new DockerComposeManager(new DockerRunner(runner));
    const out = await mgr.status("task_abc123", wt);
    expect(out).toContain("web");
    expect(runner.calls[0]).toContain("ps");

    const emptyRunner = new ScriptedRunner();
    const emptyMgr = new DockerComposeManager(new DockerRunner(emptyRunner));
    expect(await emptyMgr.status("task_abc123", empty)).toBe("");
    expect(emptyRunner.calls.length).toBe(0);
  } finally {
    rmSync(wt, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

test("logs() returns logs output and passes --no-color", async () => {
  const wt = worktreeWithCompose();
  try {
    const runner = new ScriptedRunner({ code: 0, stdout: "web | started\n", stderr: "" });
    const mgr = new DockerComposeManager(new DockerRunner(runner));
    const out = await mgr.logs("task_abc123", wt);
    expect(out).toContain("started");
    expect(runner.calls[0]).toContain("logs");
    expect(runner.calls[0]).toContain("--no-color");
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test("downByProject() runs compose down by project name without -f; returns true on success", async () => {
  const runner = new ScriptedRunner();
  const mgr = new DockerComposeManager(new DockerRunner(runner));
  const ok = await mgr.downByProject("grove-task_gone");
  expect(ok).toBe(true);
  expect(runner.calls[0]).toEqual([
    "compose",
    "-p",
    "grove-task_gone",
    "down",
    "--volumes",
    "--remove-orphans",
  ]);
});

test("downByProject() returns false (not throw) when the project is unknown", async () => {
  const runner = new ScriptedRunner({ code: 1, stdout: "", stderr: "no configuration file" });
  const mgr = new DockerComposeManager(new DockerRunner(runner));
  expect(await mgr.downByProject("grove-task_gone")).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/compose-manager.test.ts`
Expected: PASS — 9 pass total (5 from Task 3 + 4 new).

- [ ] **Step 3: Commit**

```bash
git add test/infra/compose-manager.test.ts
git commit -m "test: lock ComposeManager status/logs/downByProject behavior"
```

---

## Task 5: ComposeManager real-Docker integration test (flag-gated)

**Files:**
- Test: `test/infra/compose-manager.integration.test.ts`

Runs a real Compose stack only when `GROVE_DOCKER_TESTS=1` is set, so the default suite needs no Docker.

- [ ] **Step 1: Write the test**

`test/infra/compose-manager.integration.test.ts`:
```typescript
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerComposeManager } from "../../src/infra/compose-manager.ts";
import { DockerRunner } from "../../src/infra/docker-runner.ts";
import { BunCommandRunner } from "../../src/infra/command-runner.ts";

const ENABLED = process.env.GROVE_DOCKER_TESTS === "1";
const maybe = ENABLED ? test : test.skip;

let wt: string;
const taskId = "task_dockerit1";

beforeEach(() => {
  wt = mkdtempSync(join(tmpdir(), "grove-dockerit-"));
  // A trivial, fast service that exits immediately is not useful for `up -d`;
  // use a long-running tiny image so the container stays up.
  writeFileSync(
    join(wt, "docker-compose.yml"),
    "services:\n  sleeper:\n    image: busybox\n    command: sleep 300\n",
  );
});

afterEach(async () => {
  // Best-effort teardown even if the test failed mid-way.
  const mgr = new DockerComposeManager(new DockerRunner(new BunCommandRunner()));
  await mgr.down(taskId, wt).catch(() => {});
  rmSync(wt, { recursive: true, force: true });
});

maybe("up → status → down against real docker compose", async () => {
  const mgr = new DockerComposeManager(new DockerRunner(new BunCommandRunner()));

  const started = await mgr.up(taskId, wt);
  expect(started).toBe(true);

  const status = await mgr.status(taskId, wt);
  expect(status.toLowerCase()).toContain("sleeper");

  const stopped = await mgr.down(taskId, wt);
  expect(stopped).toBe(true);
}, 60000);
```

- [ ] **Step 2: Run the test (default: skipped)**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/compose-manager.integration.test.ts`
Expected: PASS — the test is **skipped** (shows as skipped, suite passes) because `GROVE_DOCKER_TESTS` is unset.

- [ ] **Step 3: (Optional) Run it for real if Docker is available**

Run: `export PATH="$HOME/.bun/bin:$PATH"; GROVE_DOCKER_TESTS=1 bun test test/infra/compose-manager.integration.test.ts`
Expected: PASS — 1 pass (pulls busybox, starts/stops the stack). Skip this step if Docker isn't running; it does not gate the plan.

- [ ] **Step 4: Commit**

```bash
git add test/infra/compose-manager.integration.test.ts
git commit -m "test: flag-gated real-docker integration for ComposeManager"
```

---

## Task 6: InfraManager facade

**Files:**
- Create: `src/infra/infra-manager.ts`
- Test: `test/infra/infra-manager.test.ts`

Composes `WorktreeManager` + `ComposeManager`. `provision` creates the worktree then brings up compose; `teardown` brings down compose then removes the worktree. Tested with fake managers (no git/docker).

- [ ] **Step 1: Write the failing test**

`test/infra/infra-manager.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { InfraManager } from "../../src/infra/infra-manager.ts";
import type { WorktreeManager, Worktree } from "../../src/infra/worktree-manager.ts";
import type { ComposeManager } from "../../src/infra/compose-manager.ts";

class FakeWorktrees implements WorktreeManager {
  removed: string[] = [];
  async create(taskId: string, _title: string): Promise<Worktree> {
    return { taskId, worktreePath: `/grove/tasks/${taskId}/worktree`, branch: `grove/${taskId}` };
  }
  async remove(taskId: string): Promise<void> {
    this.removed.push(taskId);
  }
  async list(): Promise<string[]> {
    return [];
  }
  async getDiff(_taskId: string): Promise<string> {
    return "";
  }
}

class FakeCompose implements ComposeManager {
  ups: Array<{ taskId: string; wt: string }> = [];
  downs: string[] = [];
  constructor(private started: boolean) {}
  async up(taskId: string, worktreePath: string): Promise<boolean> {
    this.ups.push({ taskId, wt: worktreePath });
    return this.started;
  }
  async down(taskId: string, _wt: string): Promise<boolean> {
    this.downs.push(taskId);
    return this.started;
  }
  async downByProject(_p: string): Promise<boolean> {
    return true;
  }
  async status(): Promise<string> {
    return "";
  }
  async logs(): Promise<string> {
    return "";
  }
}

test("provision creates the worktree then brings up compose", async () => {
  const wts = new FakeWorktrees();
  const compose = new FakeCompose(true);
  const infra = new InfraManager(wts, compose);

  const result = await infra.provision("task_x", "Add Thing");

  expect(result.worktree.worktreePath).toBe("/grove/tasks/task_x/worktree");
  expect(result.composeStarted).toBe(true);
  expect(compose.ups[0]).toEqual({ taskId: "task_x", wt: "/grove/tasks/task_x/worktree" });
});

test("provision reports composeStarted=false for a worktree-only task", async () => {
  const infra = new InfraManager(new FakeWorktrees(), new FakeCompose(false));
  const result = await infra.provision("task_y", "No Services");
  expect(result.composeStarted).toBe(false);
});

test("teardown brings down compose then removes the worktree", async () => {
  const wts = new FakeWorktrees();
  const compose = new FakeCompose(true);
  const infra = new InfraManager(wts, compose);

  await infra.teardown("task_x", "/grove/tasks/task_x/worktree");

  expect(compose.downs).toEqual(["task_x"]);
  expect(wts.removed).toEqual(["task_x"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/infra-manager.test.ts`
Expected: FAIL — "Cannot find module '../../src/infra/infra-manager.ts'".

- [ ] **Step 3: Write the implementation**

`src/infra/infra-manager.ts`:
```typescript
import type { WorktreeManager, Worktree } from "./worktree-manager.ts";
import type { ComposeManager } from "./compose-manager.ts";

export interface ProvisionResult {
  worktree: Worktree;
  composeStarted: boolean;
}

export class InfraManager {
  constructor(
    private worktrees: WorktreeManager,
    private compose: ComposeManager,
  ) {}

  /** Create the task's isolated worktree, then bring up its compose stack (if any). */
  async provision(taskId: string, title: string): Promise<ProvisionResult> {
    const worktree = await this.worktrees.create(taskId, title);
    const composeStarted = await this.compose.up(taskId, worktree.worktreePath);
    return { worktree, composeStarted };
  }

  /** Bring down the task's compose stack, then remove its worktree. */
  async teardown(taskId: string, worktreePath: string): Promise<void> {
    await this.compose.down(taskId, worktreePath);
    await this.worktrees.remove(taskId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/infra-manager.test.ts`
Expected: PASS — 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/infra/infra-manager.ts test/infra/infra-manager.test.ts
git commit -m "feat: add InfraManager provision/teardown facade"
```

---

## Task 7: GC orphan detection

**Files:**
- Create: `src/cli/gc.ts`
- Test: `test/cli/gc.test.ts`

`findOrphans` is pure reconciliation logic: given the set of task ids that currently exist on disk (worktree dirs) and as Compose projects, plus a lookup of each task's status from the Store, it returns the ids that are reclaimable (task absent, or in a terminal `done`/`stopped` state). It never decides for `running`/`waiting_confirm`/`blocked`.

- [ ] **Step 1: Write the failing test**

`test/cli/gc.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { findOrphans, type TaskStatusLookup } from "../../src/cli/gc.ts";

const lookup = (m: Record<string, string | undefined>): TaskStatusLookup => ({
  statusOf: (taskId: string) => (m[taskId] ?? null) as any,
});

test("findOrphans reclaims tasks absent from the store", () => {
  const orphans = findOrphans(["task_a", "task_b"], lookup({ task_a: "running" }));
  // task_b has no status row → reclaimable; task_a is running → kept
  expect(orphans).toEqual(["task_b"]);
});

test("findOrphans reclaims terminal tasks (done/stopped)", () => {
  const orphans = findOrphans(
    ["task_a", "task_b", "task_c"],
    lookup({ task_a: "done", task_b: "stopped", task_c: "waiting_confirm" }),
  );
  expect(orphans.sort()).toEqual(["task_a", "task_b"]);
});

test("findOrphans keeps running/blocked/waiting tasks", () => {
  const orphans = findOrphans(
    ["task_a", "task_b", "task_c"],
    lookup({ task_a: "running", task_b: "blocked", task_c: "waiting_confirm" }),
  );
  expect(orphans).toEqual([]);
});

test("findOrphans de-duplicates ids seen from multiple sources", () => {
  const orphans = findOrphans(["task_a", "task_a", "task_b"], lookup({}));
  expect(orphans.sort()).toEqual(["task_a", "task_b"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/gc.test.ts`
Expected: FAIL — "Cannot find module '../../src/cli/gc.ts'".

- [ ] **Step 3: Write the implementation**

`src/cli/gc.ts`:
```typescript
import type { TaskStatus } from "../domain/types.ts";

/** Lookup of a task's status by id; null when the task is absent from the store. */
export interface TaskStatusLookup {
  statusOf(taskId: string): TaskStatus | null;
}

const TERMINAL: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["done", "stopped"]);

/**
 * Given candidate task ids discovered on disk / as compose projects, return the ids
 * that are safe to reclaim: those absent from the store, or in a terminal state.
 * Never reclaims running / waiting_confirm / blocked tasks.
 */
export function findOrphans(candidateIds: string[], lookup: TaskStatusLookup): string[] {
  const seen = new Set<string>();
  const orphans: string[] = [];
  for (const id of candidateIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const status = lookup.statusOf(id);
    if (status === null || TERMINAL.has(status)) {
      orphans.push(id);
    }
  }
  return orphans;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/gc.test.ts`
Expected: PASS — 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/gc.ts test/cli/gc.test.ts
git commit -m "feat: add gc orphan-detection logic"
```

---

## Task 8: GC discovery + reclamation

**Files:**
- Modify: `src/cli/gc.ts` (add `discoverTaskIds` + `runGc`)
- Test: `test/cli/gc.reclaim.test.ts`

`discoverTaskIds` enumerates candidate ids from (a) worktree directories under `paths.tasksDir` and (b) `grove-`-prefixed Compose projects (`docker compose ls`). `runGc` reconciles via the Store, removes each orphan's worktree + compose project, and returns a report. Removal is best-effort (a failure on one orphan doesn't abort the rest).

- [ ] **Step 1: Write the failing test**

`test/cli/gc.reclaim.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { runGc, type GcDeps } from "../../src/cli/gc.ts";

function deps(over: Partial<GcDeps>): GcDeps {
  return {
    discover: async () => ["task_old", "task_live"],
    statusOf: (id) => (id === "task_live" ? "running" : null),
    removeWorktree: async () => {},
    downProject: async () => true,
    ...over,
  };
}

test("runGc reclaims only orphans, leaving live tasks alone", async () => {
  const removedWts: string[] = [];
  const downedProjects: string[] = [];
  const report = await runGc(
    deps({
      removeWorktree: async (id) => {
        removedWts.push(id);
      },
      downProject: async (project) => {
        downedProjects.push(project);
        return true;
      },
    }),
  );

  expect(report.reclaimed).toEqual(["task_old"]);
  expect(report.kept).toEqual(["task_live"]);
  expect(removedWts).toEqual(["task_old"]);
  expect(downedProjects).toEqual(["grove-task_old"]);
});

test("runGc continues past a failure on one orphan", async () => {
  const report = await runGc(
    deps({
      discover: async () => ["task_x", "task_y"],
      statusOf: () => null, // both orphans
      removeWorktree: async (id) => {
        if (id === "task_x") throw new Error("rm failed");
      },
      downProject: async () => true,
    }),
  );
  // Both attempted; task_x records an error, task_y reclaimed cleanly.
  expect(report.reclaimed).toContain("task_y");
  expect(report.errors.some((e) => e.taskId === "task_x")).toBe(true);
});

test("runGc with no orphans reports nothing reclaimed", async () => {
  const report = await runGc(
    deps({ discover: async () => ["task_live"], statusOf: () => "running" }),
  );
  expect(report.reclaimed).toEqual([]);
  expect(report.kept).toEqual(["task_live"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/gc.reclaim.test.ts`
Expected: FAIL — `runGc`/`GcDeps` are not exported.

- [ ] **Step 3: Extend `src/cli/gc.ts`**

Add to `src/cli/gc.ts` (keep the existing `findOrphans`/`TaskStatusLookup`):
```typescript
import { existsSync, readdirSync } from "node:fs";
import type { GrovePaths } from "../config/paths.ts";
import type { Store } from "../store/store.ts";
import type { DockerRunner } from "../infra/docker-runner.ts";
import type { WorktreeManager } from "../infra/worktree-manager.ts";
import type { ComposeManager } from "../infra/compose-manager.ts";
import { composeProjectFor } from "../infra/compose-manager.ts";

/** Injectable side-effects for runGc, so the reconciliation loop is unit-testable. */
export interface GcDeps {
  discover(): Promise<string[]>;
  statusOf(taskId: string): TaskStatus | null;
  removeWorktree(taskId: string): Promise<void>;
  downProject(project: string): Promise<boolean>;
}

export interface GcReport {
  reclaimed: string[];
  kept: string[];
  errors: Array<{ taskId: string; message: string }>;
}

export async function runGc(deps: GcDeps): Promise<GcReport> {
  const candidates = await deps.discover();
  const orphans = findOrphans(candidates, { statusOf: deps.statusOf });
  const orphanSet = new Set(orphans);

  const report: GcReport = { reclaimed: [], kept: [], errors: [] };
  for (const id of new Set(candidates)) {
    if (!orphanSet.has(id)) {
      report.kept.push(id);
      continue;
    }
    try {
      await deps.downProject(composeProjectFor(id));
      await deps.removeWorktree(id);
      report.reclaimed.push(id);
    } catch (err) {
      report.errors.push({ taskId: id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return report;
}

/**
 * Enumerate candidate task ids from on-disk worktree dirs and grove- compose projects.
 * Used to build the real GcDeps; kept separate so runGc stays unit-testable.
 */
export async function discoverTaskIds(paths: GrovePaths, docker: DockerRunner): Promise<string[]> {
  const ids = new Set<string>();

  // (a) worktree directories under ~/.grove/tasks/
  if (existsSync(paths.tasksDir)) {
    for (const entry of readdirSync(paths.tasksDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("task_")) ids.add(entry.name);
    }
  }

  // (b) grove- compose projects (docker compose ls --all --format json)
  try {
    const out = await docker.docker(["compose", "ls", "--all", "--format", "json"]);
    const projects = JSON.parse(out) as Array<{ Name?: string }>;
    for (const p of projects) {
      const name = p.Name ?? "";
      if (name.startsWith("grove-task_")) ids.add(name.slice("grove-".length));
    }
  } catch {
    // docker not available / no projects — disk sweep still applies.
  }

  return [...ids];
}

/** Build real GcDeps wired to the store, worktree manager, and compose manager. */
export function gcDeps(
  paths: GrovePaths,
  store: Store,
  docker: DockerRunner,
  worktrees: WorktreeManager,
  compose: ComposeManager,
): GcDeps {
  return {
    discover: () => discoverTaskIds(paths, docker),
    statusOf: (taskId) => store.getTask(taskId)?.status ?? null,
    removeWorktree: (taskId) => worktrees.remove(taskId),
    downProject: (project) => compose.downByProject(project),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/gc.reclaim.test.ts`
Expected: PASS — 3 pass.

- [ ] **Step 5: Run the GC suite + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/gc.test.ts test/cli/gc.reclaim.test.ts && bun run typecheck`
Expected: all pass; `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/cli/gc.ts test/cli/gc.reclaim.test.ts
git commit -m "feat: add gc discovery + reclamation"
```

---

## Task 9: Wire `gc` into the CLI

**Files:**
- Modify: `src/cli/index.ts`
- Test: `test/cli/index.gc.test.ts`

Adds `grove gc` (lists reclaimable orphans, confirms unless `--yes`, then reclaims). Wires real deps via `gcDeps`. Because confirmation needs stdin, the test exercises the `--yes` path (non-interactive).

- [ ] **Step 1: Write the failing test**

`test/cli/index.gc.test.ts`:
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

test("grove gc --yes runs and reports (no orphans on a fresh home)", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  mkdirSync(join(root, "tasks"), { recursive: true });
  try {
    const { code, stdout } = await runCli(["gc", "--yes"], { GROVE_HOME: root });
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toContain("gc");
    // Fresh home: nothing to reclaim.
    expect(stdout.toLowerCase()).toMatch(/nothing to reclaim|reclaimed 0|no orphans/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/index.gc.test.ts`
Expected: FAIL — `gc` is unknown so it prints usage; the assertion on "gc"/"nothing to reclaim" fails.

- [ ] **Step 3: Update `src/cli/index.ts`**

Add these imports below the existing imports:
```typescript
import { SqliteStore } from "../store/sqlite-store.ts";
import { DockerRunner } from "../infra/docker-runner.ts";
import { GitRunner } from "../infra/git-runner.ts";
import { GitWorktreeManager } from "../infra/worktree-manager.ts";
import { DockerComposeManager } from "../infra/compose-manager.ts";
import { runGc, gcDeps } from "./gc.ts";
```

Add a `case "gc":` to the `switch` in `main`, before `default`:
```typescript
    case "gc": {
      const yes = argv.includes("--yes");
      const paths = grovePaths();
      const runner = new BunCommandRunner();
      const store = SqliteStore.open(paths.dbFile);
      try {
        const docker = new DockerRunner(runner);
        const git = new GitRunner(runner, process.cwd());
        const worktrees = new GitWorktreeManager(git, paths);
        const compose = new DockerComposeManager(docker);
        const deps = gcDeps(paths, store, docker, worktrees, compose);

        const candidates = await deps.discover();
        const { findOrphans } = await import("./gc.ts");
        const orphans = findOrphans(candidates, { statusOf: deps.statusOf });

        if (orphans.length === 0) {
          console.log("grove gc: nothing to reclaim.");
          return 0;
        }
        console.log(`grove gc will reclaim ${orphans.length} orphaned task(s):`);
        for (const id of orphans) console.log(`  - ${id}`);
        if (!yes) {
          console.log("\nRe-run with --yes to reclaim them.");
          return 0;
        }
        const report = await runGc(deps);
        console.log(`\nReclaimed ${report.reclaimed.length}, kept ${report.kept.length}, errors ${report.errors.length}.`);
        for (const e of report.errors) console.log(`  ! ${e.taskId}: ${e.message}`);
        return report.errors.length === 0 ? 0 : 1;
      } finally {
        store.close();
      }
    }
```

Update the usage string in `printUsage`:
```typescript
  console.log("grove — usage: grove [init | gc [--yes] | doctor | --version]");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/index.gc.test.ts`
Expected: PASS — 1 pass.

- [ ] **Step 5: Run the full suite, typecheck, and build smoke test**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck && bun run build && GROVE_HOME=/tmp/grove-gc ./dist/grove gc --yes && rm -rf /tmp/grove-gc`
Expected: all tests PASS; `tsc --noEmit` clean; binary builds; `grove gc --yes` runs on an empty home and prints "nothing to reclaim." (It does not require Docker — discovery tolerates docker being absent.)

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts test/cli/index.gc.test.ts
git commit -m "feat: wire gc command into the CLI"
```

---

## Self-Review (completed during planning)

**Spec coverage (Plan 2b slice of §5.2, §5.3, §8.3):**
- `ComposeManager` up/down/status/logs (§5.2) → Tasks 3–5 ✓; project name `grove-<id>` (§5.2) → `composeProjectFor` ✓; **no compose file → skip** (§5.2) → Tasks 3–4 no-op tests ✓; no host-port publishing (brainstorm decision) → `up` uses only `up -d`, no `-p`/port flags ✓
- `InfraManager` facade provision/teardown (§5.3) → Task 6 ✓; teardown-on-finish ordering (compose down → worktree remove) ✓
- `grove gc` reclaims **grove-owned only**, **Store-reconciled**, **never global prune** (§8.3) → Tasks 7–9 ✓; discovery filters strictly on `task_`/`grove-task_` prefixes ✓; confirmation + `--yes` ✓; conservative (terminal/absent only) ✓
- Typed docker wrapper (mirrors the §5.1/§5.2 "typed wrapper" pattern) → `DockerRunner` Task 1 ✓
- Real-docker integration behind a flag (§10 testing) → Task 5 ✓

**Intentionally deferred (not gaps):** dynamic host-port allocation (`PortAllocator`); Docker-owned disk accounting in `DiskMonitor`; the engine consulting `DiskMonitor` before provisioning (Plan 4); dangling `grove-` *image* pruning (the conservative `compose down --volumes --remove-orphans` + `downByProject` reclaim containers/volumes/networks; image pruning is a later refinement). `InfraManager` does not gate on disk (engine's job, Plan 4). `list()` filtering out the main repo worktree (Plan 2a carry-forward) is not needed here because gc discovers ids from `paths.tasksDir` entries (which never include the main repo) rather than `WorktreeManager.list()`.

**Placeholder scan:** none — every code/test step is complete.

**Type consistency:** `DockerRunner.docker/compose/composeOk`, `ComposeManager` (`up/down/downByProject/status/logs`) + `composeProjectFor`, `InfraManager(worktrees, compose)` with `provision→ProvisionResult{worktree, composeStarted}`/`teardown`, and `gc.ts` (`findOrphans`, `TaskStatusLookup`, `GcDeps`, `GcReport`, `runGc`, `discoverTaskIds`, `gcDeps`) are defined once and used consistently across tasks and the CLI wiring. `composeProjectFor(taskId)` = `grove-<taskId>` is used identically in ComposeManager and gc. `TaskStatus` values match the domain type from Plan 1.
