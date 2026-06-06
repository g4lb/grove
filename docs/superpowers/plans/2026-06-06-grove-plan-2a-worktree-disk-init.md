# grove — Plan 2a: Code Isolation, Disk Monitoring & Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build grove's code-isolation half of the infra layer — a `GitRunner` wrapper, a `WorktreeManager` (one git worktree + branch per task), a `DiskMonitor` (free-space + grove-owned usage with warn/block thresholds), and the `init` command that sets up `~/.grove` and validates the environment.

**Architecture:** Each manager is an interface with a concrete adapter that shells out through the existing `CommandRunner` (Plan 1), so all logic is unit-testable with a fake runner; a small set of real-`git` integration tests run inline because git is available. Worktrees live under `~/.grove/tasks/<id>/worktree` on branch `grove/<id>-<slug>`, branched off the repo's current `HEAD`. The repo is the directory grove runs in. `DiskMonitor` is read-only/advisory and consulted before provisioning.

**Tech Stack:** Bun (runtime + `bun test` + `bun:sqlite`), TypeScript (strict), the Plan 1 modules (`CommandRunner`, `Store`/`SqliteStore`, `resolvePaths`, `loadConfig`, domain types).

---

## Context for the implementer (read once)

Plan 1 is merged on `main`. The codebase already has:
- `src/infra/command-runner.ts` — `CommandRunner` interface `{ run(cmd, args): Promise<CommandResult> }`, `CommandResult { code, stdout, stderr }`, and `BunCommandRunner`.
- `src/config/paths.ts` — `resolvePaths(root?)` → `GrovePaths { root, dbFile, tasksDir, configFile, taskDir(id) }`.
- `src/config/config.ts` — `GroveConfig { disk: { warnBytes, blockBytes } }`, `DEFAULT_CONFIG`, `loadConfig`, `saveConfig`.
- `src/store/*` — `Store` interface + `SqliteStore` adapter.
- `src/cli/doctor.ts` — `runDoctor(runner): Promise<DoctorReport>`; `src/cli/index.ts` — dispatch for `--version`/`doctor`.
- `src/domain/ids.ts` — `newId(prefix)`; `src/domain/types.ts`.

**Environment quirk:** bun is installed at `~/.bun/bin/bun` but NOT on PATH. Prepend `export PATH="$HOME/.bun/bin:$PATH";` to every bun command (shell state does not persist between calls). Verify: `export PATH="$HOME/.bun/bin:$PATH"; bun --version` → `1.3.14`.

Imports use explicit `.ts` extensions. TDD throughout: failing test → run it fails → implement → run it passes → commit. One logical change per commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/infra/git-runner.ts` | `GitRunner` — thin typed wrapper over `CommandRunner` for the git subcommands the worktree manager needs (rev-parse, worktree add/remove/list, diff) |
| `src/infra/worktree-manager.ts` | `WorktreeManager` interface + `GitWorktreeManager` adapter (create/remove/list/getDiff) |
| `src/infra/slug.ts` | `slugify(title)` — branch-safe slug from a task title |
| `src/infra/disk-monitor.ts` | `DiskMonitor` interface + `ShellDiskMonitor` adapter (free space via `df`, grove usage via `du`) + threshold evaluation |
| `src/cli/init.ts` | `runInit(...)` — create `~/.grove` dirs + db + default config, validate cwd is a git repo, run doctor |
| `src/cli/index.ts` | (modify) add `init` subcommand dispatch |
| `test/infra/*`, `test/cli/init.test.ts` | one test file per module |

---

## Task 1: Slug helper

**Files:**
- Create: `src/infra/slug.ts`
- Test: `test/infra/slug.test.ts`

- [ ] **Step 1: Write the failing test**

`test/infra/slug.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { slugify } from "../../src/infra/slug.ts";

test("slugify lowercases and hyphenates words", () => {
  expect(slugify("Add OAuth Login")).toBe("add-oauth-login");
});

test("slugify strips non-alphanumeric and collapses separators", () => {
  expect(slugify("Fix:  the   checkout!! bug")).toBe("fix-the-checkout-bug");
});

test("slugify trims leading/trailing hyphens", () => {
  expect(slugify("  --Hello--  ")).toBe("hello");
});

test("slugify truncates to 40 chars without a trailing hyphen", () => {
  const s = slugify("a".repeat(60));
  expect(s.length).toBe(40);
  expect(s.endsWith("-")).toBe(false);
});

test("slugify falls back to 'task' for empty/symbol-only input", () => {
  expect(slugify("!!!")).toBe("task");
  expect(slugify("")).toBe("task");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/slug.test.ts`
Expected: FAIL — "Cannot find module '../../src/infra/slug.ts'".

- [ ] **Step 3: Write the implementation**

`src/infra/slug.ts`:
```typescript
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "task";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/slug.test.ts`
Expected: PASS — 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/infra/slug.ts test/infra/slug.test.ts
git commit -m "feat: add branch-safe slugify helper"
```

---

## Task 2: GitRunner wrapper

**Files:**
- Create: `src/infra/git-runner.ts`
- Test: `test/infra/git-runner.test.ts`

A thin typed wrapper over `CommandRunner` that runs `git` subcommands and throws a clear error on non-zero exit. Keeps `WorktreeManager` free of raw command strings and trivially mockable.

- [ ] **Step 1: Write the failing test**

`test/infra/git-runner.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { GitRunner } from "../../src/infra/git-runner.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class RecordingRunner implements CommandRunner {
  calls: Array<{ cmd: string; args: string[] }> = [];
  constructor(private result: CommandResult) {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    this.calls.push({ cmd, args });
    return this.result;
  }
}

test("git() runs git with the given args and returns trimmed stdout", async () => {
  const runner = new RecordingRunner({ code: 0, stdout: "abc123\n", stderr: "" });
  const git = new GitRunner(runner, "/repo");
  const out = await git.git(["rev-parse", "HEAD"]);
  expect(out).toBe("abc123");
  expect(runner.calls[0]!.cmd).toBe("git");
  // -C /repo is injected so git runs in the repo dir
  expect(runner.calls[0]!.args).toEqual(["-C", "/repo", "rev-parse", "HEAD"]);
});

test("git() throws with stderr on non-zero exit", async () => {
  const runner = new RecordingRunner({ code: 128, stdout: "", stderr: "fatal: not a git repository" });
  const git = new GitRunner(runner, "/repo");
  await expect(git.git(["status"])).rejects.toThrow("fatal: not a git repository");
});

test("isGitRepo returns true on exit 0, false otherwise", async () => {
  const ok = new GitRunner(new RecordingRunner({ code: 0, stdout: "true\n", stderr: "" }), "/repo");
  expect(await ok.isGitRepo()).toBe(true);
  const no = new GitRunner(new RecordingRunner({ code: 128, stdout: "", stderr: "fatal" }), "/repo");
  expect(await no.isGitRepo()).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/git-runner.test.ts`
Expected: FAIL — "Cannot find module '../../src/infra/git-runner.ts'".

- [ ] **Step 3: Write the implementation**

`src/infra/git-runner.ts`:
```typescript
import type { CommandRunner } from "./command-runner.ts";

export class GitRunner {
  constructor(
    private runner: CommandRunner,
    private repoPath: string,
  ) {}

  /** Run a git subcommand inside the repo; returns trimmed stdout, throws on non-zero exit. */
  async git(args: string[]): Promise<string> {
    const res = await this.runner.run("git", ["-C", this.repoPath, ...args]);
    if (res.code !== 0) {
      throw new Error(`git ${args.join(" ")} failed (exit ${res.code}): ${res.stderr.trim()}`);
    }
    return res.stdout.trim();
  }

  /** True if repoPath is inside a git work tree. */
  async isGitRepo(): Promise<boolean> {
    const res = await this.runner.run("git", [
      "-C",
      this.repoPath,
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    return res.code === 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/git-runner.test.ts`
Expected: PASS — 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/infra/git-runner.ts test/infra/git-runner.test.ts
git commit -m "feat: add GitRunner typed wrapper over CommandRunner"
```

---

## Task 3: WorktreeManager interface + create()

**Files:**
- Create: `src/infra/worktree-manager.ts`
- Test: `test/infra/worktree-manager.test.ts`

`create` makes a worktree at `<paths.taskDir(id)>/worktree` on branch `grove/<id>-<slug>`, branched off the repo's current `HEAD`. The branch name uses the **short** task id suffix + slug to stay readable.

- [ ] **Step 1: Write the failing test**

`test/infra/worktree-manager.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { GitWorktreeManager } from "../../src/infra/worktree-manager.ts";
import { GitRunner } from "../../src/infra/git-runner.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";
import { resolvePaths } from "../../src/config/paths.ts";

class ScriptedRunner implements CommandRunner {
  calls: string[][] = [];
  constructor(private script: (args: string[]) => CommandResult) {}
  async run(_cmd: string, args: string[]): Promise<CommandResult> {
    this.calls.push(args);
    return this.script(args);
  }
}

const OK = (stdout = ""): CommandResult => ({ code: 0, stdout, stderr: "" });

test("create() makes a worktree on a grove/<id>-<slug> branch off HEAD", async () => {
  const paths = resolvePaths("/groveroot");
  const runner = new ScriptedRunner((args) => OK());
  const git = new GitRunner(runner, "/repo");
  const mgr = new GitWorktreeManager(git, paths);

  const result = await mgr.create("task_1234abcd", "Add OAuth Login");

  expect(result.branch).toBe("grove/1234abcd-add-oauth-login");
  expect(result.worktreePath).toBe("/groveroot/tasks/task_1234abcd/worktree");

  // The worktree add invocation includes -b <branch> <path> HEAD
  const addCall = runner.calls.find((a) => a.includes("worktree") && a.includes("add"))!;
  expect(addCall).toContain("-b");
  expect(addCall).toContain("grove/1234abcd-add-oauth-login");
  expect(addCall).toContain("/groveroot/tasks/task_1234abcd/worktree");
  expect(addCall[addCall.length - 1]).toBe("HEAD");
});

test("create() throws if git worktree add fails", async () => {
  const paths = resolvePaths("/groveroot");
  const runner = new ScriptedRunner(() => ({ code: 128, stdout: "", stderr: "fatal: already exists" }));
  const git = new GitRunner(runner, "/repo");
  const mgr = new GitWorktreeManager(git, paths);
  await expect(mgr.create("task_1234abcd", "x")).rejects.toThrow("already exists");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/worktree-manager.test.ts`
Expected: FAIL — "Cannot find module '../../src/infra/worktree-manager.ts'".

- [ ] **Step 3: Write the implementation**

`src/infra/worktree-manager.ts`:
```typescript
import { join } from "node:path";
import type { GrovePaths } from "../config/paths.ts";
import type { GitRunner } from "./git-runner.ts";
import { slugify } from "./slug.ts";

export interface Worktree {
  taskId: string;
  worktreePath: string;
  branch: string;
}

export interface WorktreeManager {
  create(taskId: string, title: string): Promise<Worktree>;
  remove(taskId: string): Promise<void>;
  list(): Promise<string[]>;
  getDiff(taskId: string): Promise<string>;
}

/** Short suffix of a `task_<hex>` id, used in the human-facing branch name. */
function shortId(taskId: string): string {
  const underscore = taskId.indexOf("_");
  const raw = underscore >= 0 ? taskId.slice(underscore + 1) : taskId;
  return raw.slice(0, 8);
}

export class GitWorktreeManager implements WorktreeManager {
  constructor(
    private git: GitRunner,
    private paths: GrovePaths,
  ) {}

  private worktreePathFor(taskId: string): string {
    return join(this.paths.taskDir(taskId), "worktree");
  }

  async create(taskId: string, title: string): Promise<Worktree> {
    const branch = `grove/${shortId(taskId)}-${slugify(title)}`;
    const worktreePath = this.worktreePathFor(taskId);
    await this.git.git(["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
    return { taskId, worktreePath, branch };
  }

  async remove(taskId: string): Promise<void> {
    const worktreePath = this.worktreePathFor(taskId);
    await this.git.git(["worktree", "remove", "--force", worktreePath]);
  }

  async list(): Promise<string[]> {
    const out = await this.git.git(["worktree", "list", "--porcelain"]);
    return out
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length));
  }

  async getDiff(taskId: string): Promise<string> {
    const worktreePath = this.worktreePathFor(taskId);
    const res = await this.git.git(["-C", worktreePath, "diff", "HEAD"]);
    return res;
  }
}
```

> Note: `getDiff` passes an extra `-C <worktreePath>` *inside* the args; combined with `GitRunner`'s own `-C <repoPath>`, git uses the last `-C`, so the diff is taken in the worktree. This is intentional and covered by Task 4's test.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/worktree-manager.test.ts`
Expected: PASS — 2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/infra/worktree-manager.ts test/infra/worktree-manager.test.ts
git commit -m "feat: add WorktreeManager.create"
```

---

## Task 4: WorktreeManager remove / list / getDiff

**Files:**
- Modify: `test/infra/worktree-manager.test.ts` (add tests)
- (implementation already written in Task 3 — these tests lock its behavior)

- [ ] **Step 1: Write the failing tests**

Append to `test/infra/worktree-manager.test.ts`:
```typescript
test("remove() calls git worktree remove --force on the task worktree", async () => {
  const paths = resolvePaths("/groveroot");
  const runner = new ScriptedRunner(() => OK());
  const git = new GitRunner(runner, "/repo");
  const mgr = new GitWorktreeManager(git, paths);

  await mgr.remove("task_1234abcd");

  const call = runner.calls.find((a) => a.includes("worktree") && a.includes("remove"))!;
  expect(call).toContain("--force");
  expect(call).toContain("/groveroot/tasks/task_1234abcd/worktree");
});

test("list() parses porcelain output into worktree paths", async () => {
  const paths = resolvePaths("/groveroot");
  const porcelain = [
    "worktree /repo",
    "HEAD deadbeef",
    "branch refs/heads/main",
    "",
    "worktree /groveroot/tasks/task_1/worktree",
    "HEAD cafef00d",
    "branch refs/heads/grove/1-x",
    "",
  ].join("\n");
  const runner = new ScriptedRunner(() => OK(porcelain));
  const git = new GitRunner(runner, "/repo");
  const mgr = new GitWorktreeManager(git, paths);

  const paths2 = await mgr.list();
  expect(paths2).toEqual(["/repo", "/groveroot/tasks/task_1/worktree"]);
});

test("getDiff() runs diff inside the worktree dir", async () => {
  const paths = resolvePaths("/groveroot");
  const runner = new ScriptedRunner(() => OK("diff --git a/f b/f\n+x"));
  const git = new GitRunner(runner, "/repo");
  const mgr = new GitWorktreeManager(git, paths);

  const diff = await mgr.getDiff("task_1234abcd");
  expect(diff).toContain("diff --git");

  const call = runner.calls.find((a) => a.includes("diff"))!;
  // GitRunner injects -C /repo, then the manager injects -C <worktree>; git uses the last one
  expect(call).toEqual([
    "-C",
    "/repo",
    "-C",
    "/groveroot/tasks/task_1234abcd/worktree",
    "diff",
    "HEAD",
  ]);
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/worktree-manager.test.ts`
Expected: PASS — 5 pass total (2 from Task 3 + 3 new). (Implementation from Task 3 already supports these.)

- [ ] **Step 3: Commit**

```bash
git add test/infra/worktree-manager.test.ts
git commit -m "test: lock WorktreeManager remove/list/getDiff behavior"
```

---

## Task 5: WorktreeManager real-git integration test

**Files:**
- Test: `test/infra/worktree-manager.integration.test.ts`

Exercises `GitWorktreeManager` against the **real** `git` binary and `BunCommandRunner` in a temp repo, proving the porcelain parsing and worktree lifecycle actually work end to end.

- [ ] **Step 1: Write the test**

`test/infra/worktree-manager.integration.test.ts`:
```typescript
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitWorktreeManager } from "../../src/infra/worktree-manager.ts";
import { GitRunner } from "../../src/infra/git-runner.ts";
import { BunCommandRunner } from "../../src/infra/command-runner.ts";
import { resolvePaths } from "../../src/config/paths.ts";

let repo: string;
let groveRoot: string;

async function sh(cmd: string, args: string[], cwd: string) {
  const proc = Bun.spawn([cmd, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  await proc.exited;
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "grove-repo-"));
  groveRoot = mkdtempSync(join(tmpdir(), "grove-root-"));
  await sh("git", ["init", "-q", "-b", "main"], repo);
  await sh("git", ["config", "user.email", "t@t.test"], repo);
  await sh("git", ["config", "user.name", "t"], repo);
  writeFileSync(join(repo, "README.md"), "hello\n");
  await sh("git", ["add", "."], repo);
  await sh("git", ["commit", "-q", "-m", "init"], repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(groveRoot, { recursive: true, force: true });
});

test("create → list → getDiff → remove against real git", async () => {
  const paths = resolvePaths(groveRoot);
  const git = new GitRunner(new BunCommandRunner(), repo);
  const mgr = new GitWorktreeManager(git, paths);

  const wt = await mgr.create("task_abcd1234", "Add Feature");
  expect(wt.branch).toBe("grove/abcd1234-add-feature");

  // worktree exists and is listed
  const list = await mgr.list();
  expect(list.some((p) => p.endsWith("/task_abcd1234/worktree"))).toBe(true);

  // make a change in the worktree, diff sees it
  writeFileSync(join(wt.worktreePath, "README.md"), "hello\nworld\n");
  const diff = await mgr.getDiff("task_abcd1234");
  expect(diff).toContain("+world");

  // remove cleans it up
  await mgr.remove("task_abcd1234");
  const after = await mgr.list();
  expect(after.some((p) => p.endsWith("/task_abcd1234/worktree"))).toBe(false);
});
```

- [ ] **Step 2: Run the test**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/worktree-manager.integration.test.ts`
Expected: PASS — 1 pass. (If it fails, the bug is real — fix `worktree-manager.ts` or `git-runner.ts`, not the test.)

- [ ] **Step 3: Commit**

```bash
git add test/infra/worktree-manager.integration.test.ts
git commit -m "test: real-git integration for WorktreeManager lifecycle"
```

---

## Task 6: DiskMonitor — free space via df

**Files:**
- Create: `src/infra/disk-monitor.ts`
- Test: `test/infra/disk-monitor.test.ts`

`DiskMonitor` reports free bytes on the volume backing a path (via `df -k <path>`) and evaluates them against config thresholds. This task does free-space + thresholds; grove-owned usage (`du`) is Task 7.

- [ ] **Step 1: Write the failing test**

`test/infra/disk-monitor.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { ShellDiskMonitor } from "../../src/infra/disk-monitor.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class MapRunner implements CommandRunner {
  constructor(private fn: (cmd: string, args: string[]) => CommandResult) {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    return this.fn(cmd, args);
  }
}

// `df -k` prints a header line then a data line; the 4th column is available 1K-blocks.
const DF_OUTPUT = [
  "Filesystem 1024-blocks      Used Available Capacity Mounted on",
  "/dev/disk1s1  488245288 200000000  20000000      91% /",
].join("\n");

test("freeBytes parses df -k available blocks into bytes", async () => {
  const runner = new MapRunner((cmd, args) => {
    expect(cmd).toBe("df");
    expect(args).toEqual(["-k", "/some/path"]);
    return { code: 0, stdout: DF_OUTPUT, stderr: "" };
  });
  const monitor = new ShellDiskMonitor(runner);
  // 20000000 KiB * 1024 = 20480000000 bytes
  expect(await monitor.freeBytes("/some/path")).toBe(20000000 * 1024);
});

test("evaluate returns 'ok' above warn, 'warn' between, 'block' below block", () => {
  const monitor = new ShellDiskMonitor(new MapRunner(() => ({ code: 0, stdout: "", stderr: "" })));
  const thresholds = { warnBytes: 10, blockBytes: 2 };
  expect(monitor.evaluate(20, thresholds)).toBe("ok");
  expect(monitor.evaluate(5, thresholds)).toBe("warn");
  expect(monitor.evaluate(1, thresholds)).toBe("block");
  // boundaries: exactly at threshold is NOT below it
  expect(monitor.evaluate(10, thresholds)).toBe("ok");
  expect(monitor.evaluate(2, thresholds)).toBe("warn");
});

test("freeBytes throws on df failure", async () => {
  const runner = new MapRunner(() => ({ code: 1, stdout: "", stderr: "df: no such path" }));
  const monitor = new ShellDiskMonitor(runner);
  await expect(monitor.freeBytes("/nope")).rejects.toThrow("df");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/disk-monitor.test.ts`
Expected: FAIL — "Cannot find module '../../src/infra/disk-monitor.ts'".

- [ ] **Step 3: Write the implementation**

`src/infra/disk-monitor.ts`:
```typescript
import type { CommandRunner } from "./command-runner.ts";

export type DiskVerdict = "ok" | "warn" | "block";

export interface DiskThresholds {
  warnBytes: number;
  blockBytes: number;
}

export interface DiskMonitor {
  freeBytes(path: string): Promise<number>;
  evaluate(freeBytes: number, thresholds: DiskThresholds): DiskVerdict;
}

export class ShellDiskMonitor implements DiskMonitor {
  constructor(private runner: CommandRunner) {}

  async freeBytes(path: string): Promise<number> {
    const res = await this.runner.run("df", ["-k", path]);
    if (res.code !== 0) {
      throw new Error(`df -k ${path} failed (exit ${res.code}): ${res.stderr.trim()}`);
    }
    const lines = res.stdout.trim().split("\n");
    const dataLine = lines[lines.length - 1]!;
    // Columns: Filesystem, 1K-blocks, Used, Available, Capacity, Mounted on
    const cols = dataLine.trim().split(/\s+/);
    const availableKiB = Number(cols[3]);
    if (!Number.isFinite(availableKiB)) {
      throw new Error(`could not parse df output: ${dataLine}`);
    }
    return availableKiB * 1024;
  }

  evaluate(freeBytes: number, thresholds: DiskThresholds): DiskVerdict {
    if (freeBytes < thresholds.blockBytes) return "block";
    if (freeBytes < thresholds.warnBytes) return "warn";
    return "ok";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/disk-monitor.test.ts`
Expected: PASS — 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/infra/disk-monitor.ts test/infra/disk-monitor.test.ts
git commit -m "feat: add DiskMonitor free-space + threshold evaluation"
```

---

## Task 7: DiskMonitor — grove-owned usage via du

**Files:**
- Modify: `src/infra/disk-monitor.ts` (add `groveUsageBytes`)
- Test: `test/infra/disk-monitor.usage.test.ts`

Reports how many bytes grove's own data dir occupies (`du -sk <tasksDir>`), for `doctor`/TUI display. Returns 0 if the dir doesn't exist yet.

- [ ] **Step 1: Write the failing test**

`test/infra/disk-monitor.usage.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { ShellDiskMonitor } from "../../src/infra/disk-monitor.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class MapRunner implements CommandRunner {
  constructor(private fn: (cmd: string, args: string[]) => CommandResult) {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    return this.fn(cmd, args);
  }
}

test("groveUsageBytes parses du -sk total into bytes", async () => {
  const runner = new MapRunner((cmd, args) => {
    expect(cmd).toBe("du");
    expect(args).toEqual(["-sk", "/groveroot/tasks"]);
    return { code: 0, stdout: "4096\t/groveroot/tasks\n", stderr: "" };
  });
  const monitor = new ShellDiskMonitor(runner);
  expect(await monitor.groveUsageBytes("/groveroot/tasks")).toBe(4096 * 1024);
});

test("groveUsageBytes returns 0 when the directory does not exist", async () => {
  const runner = new MapRunner(() => ({ code: 1, stdout: "", stderr: "du: no such file or directory" }));
  const monitor = new ShellDiskMonitor(runner);
  expect(await monitor.groveUsageBytes("/missing")).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/disk-monitor.usage.test.ts`
Expected: FAIL — `monitor.groveUsageBytes is not a function`.

- [ ] **Step 3: Extend the implementation**

Add to the `DiskMonitor` interface in `src/infra/disk-monitor.ts`:
```typescript
  groveUsageBytes(tasksDir: string): Promise<number>;
```

Add the method to `ShellDiskMonitor`:
```typescript
  async groveUsageBytes(tasksDir: string): Promise<number> {
    const res = await this.runner.run("du", ["-sk", tasksDir]);
    if (res.code !== 0) {
      // Directory missing / not yet created → no usage.
      return 0;
    }
    const firstCol = res.stdout.trim().split(/\s+/)[0];
    const kib = Number(firstCol);
    return Number.isFinite(kib) ? kib * 1024 : 0;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/infra/disk-monitor.usage.test.ts`
Expected: PASS — 2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/infra/disk-monitor.ts test/infra/disk-monitor.usage.test.ts
git commit -m "feat: add DiskMonitor.groveUsageBytes"
```

---

## Task 8: init command logic

**Files:**
- Create: `src/cli/init.ts`
- Test: `test/cli/init.test.ts`

`runInit` is pure-ish logic taking its dependencies as arguments (a `CommandRunner` for git/doctor checks, a `GrovePaths`, and an `fs`-like writer) so it's testable without touching the real home dir. It: (1) validates cwd is a git repo, (2) creates `~/.grove` + `tasks/` dirs, (3) opens/creates the SQLite db (runs migrations), (4) writes a default config if missing, (5) returns a structured result including the doctor report.

- [ ] **Step 1: Write the failing test**

`test/cli/init.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/cli/init.ts";
import { resolvePaths } from "../../src/config/paths.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class MapRunner implements CommandRunner {
  constructor(private fn: (cmd: string, args: string[]) => CommandResult) {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    return this.fn(cmd, args);
  }
}

const OK = (stdout = ""): CommandResult => ({ code: 0, stdout, stderr: "" });

function allGreenRunner(): CommandRunner {
  return new MapRunner((cmd, args) => {
    if (cmd === "git" && args.includes("--is-inside-work-tree")) return OK("true");
    if (cmd === "git" && args.includes("--version")) return OK("git version 2.45.0");
    if (cmd === "docker" && args.includes("compose")) return OK("Docker Compose version v2.29.0");
    if (cmd === "docker") return OK("Docker version 27.0.0");
    return { code: 127, stdout: "", stderr: "not found" };
  });
}

test("runInit creates grove dirs, db, and config; reports ok", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  const paths = resolvePaths(root);
  try {
    const result = await runInit({ runner: allGreenRunner(), paths, repoPath: "/repo" });
    expect(result.ok).toBe(true);
    expect(result.isGitRepo).toBe(true);
    expect(existsSync(paths.tasksDir)).toBe(true);
    expect(existsSync(paths.dbFile)).toBe(true);
    expect(existsSync(paths.configFile)).toBe(true);
    expect(result.doctor.ok).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runInit reports not-a-git-repo and ok=false when cwd is not a repo", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  const paths = resolvePaths(root);
  const runner = new MapRunner((cmd, args) => {
    if (cmd === "git" && args.includes("--is-inside-work-tree")) return { code: 128, stdout: "", stderr: "fatal" };
    if (cmd === "git" && args.includes("--version")) return OK("git version 2.45.0");
    if (cmd === "docker" && args.includes("compose")) return OK("v2.29.0");
    if (cmd === "docker") return OK("Docker version 27.0.0");
    return { code: 127, stdout: "", stderr: "not found" };
  });
  try {
    const result = await runInit({ runner, paths, repoPath: "/repo" });
    expect(result.isGitRepo).toBe(false);
    expect(result.ok).toBe(false);
    // dirs/db still created (setup is idempotent and independent of repo check)
    expect(existsSync(paths.dbFile)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runInit is idempotent (second run does not throw or clobber config)", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  const paths = resolvePaths(root);
  try {
    await runInit({ runner: allGreenRunner(), paths, repoPath: "/repo" });
    const second = await runInit({ runner: allGreenRunner(), paths, repoPath: "/repo" });
    expect(second.ok).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/init.test.ts`
Expected: FAIL — "Cannot find module '../../src/cli/init.ts'".

- [ ] **Step 3: Write the implementation**

`src/cli/init.ts`:
```typescript
import { mkdirSync } from "node:fs";
import type { CommandRunner } from "../infra/command-runner.ts";
import type { GrovePaths } from "../config/paths.ts";
import { loadConfig, saveConfig, DEFAULT_CONFIG } from "../config/config.ts";
import { SqliteStore } from "../store/sqlite-store.ts";
import { GitRunner } from "../infra/git-runner.ts";
import { runDoctor, type DoctorReport } from "./doctor.ts";

export interface InitOptions {
  runner: CommandRunner;
  paths: GrovePaths;
  repoPath: string;
}

export interface InitResult {
  ok: boolean;
  isGitRepo: boolean;
  doctor: DoctorReport;
}

export async function runInit(opts: InitOptions): Promise<InitResult> {
  const { runner, paths, repoPath } = opts;

  // 1. Create ~/.grove and tasks/ (idempotent).
  mkdirSync(paths.tasksDir, { recursive: true });

  // 2. Open/create the SQLite db (constructor runs migrations).
  SqliteStore.open(paths.dbFile).close();

  // 3. Write a default config if none exists (loadConfig returns defaults when absent).
  const config = await loadConfig(paths);
  await saveConfig(paths, config);

  // 4. Validate the working directory is a git repo.
  const git = new GitRunner(runner, repoPath);
  const isGitRepo = await git.isGitRepo();

  // 5. Run dependency preflight.
  const doctor = await runDoctor(runner);

  return { ok: isGitRepo && doctor.ok, isGitRepo, doctor };
}
```

> Note: `saveConfig(paths, config)` writes the merged config (defaults when the file was absent), so a first run materializes `config.json` and a second run round-trips the existing values unchanged — idempotent.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/init.test.ts`
Expected: PASS — 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/init.ts test/cli/init.test.ts
git commit -m "feat: add init setup logic"
```

---

## Task 9: Wire `init` into the CLI

**Files:**
- Modify: `src/cli/index.ts`
- Test: `test/cli/index.init.test.ts`

- [ ] **Step 1: Write the failing test**

`test/cli/index.init.test.ts`:
```typescript
import { test, expect } from "bun:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
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

test("grove init creates the grove home and prints a summary", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  try {
    // GROVE_HOME overrides the default ~/.grove so the test never touches the real home.
    const { code, stdout } = await runCli(["init"], { GROVE_HOME: root });
    expect([0, 1]).toContain(code); // 0 if cwd is a git repo + deps present, else 1
    expect(stdout.toLowerCase()).toContain("grove");
    expect(existsSync(join(root, "grove.db"))).toBe(true);
    expect(existsSync(join(root, "config.json"))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/index.init.test.ts`
Expected: FAIL — `init` is unknown so it prints usage and the db is never created → `existsSync` assertion fails.

- [ ] **Step 3: Update `src/cli/index.ts`**

Add the imports at the top (below the existing imports):
```typescript
import { runInit } from "./init.ts";
import { resolvePaths } from "../config/paths.ts";
import { join } from "node:path";
import { homedir } from "node:os";
```

Add a helper above `main` to resolve the grove home (honoring a `GROVE_HOME` override for tests/power users):
```typescript
function grovePaths() {
  const root = process.env.GROVE_HOME ?? join(homedir(), ".grove");
  return resolvePaths(root);
}
```

Add a `case "init":` to the `switch` in `main`, before `default`:
```typescript
    case "init": {
      const result = await runInit({
        runner: new BunCommandRunner(),
        paths: grovePaths(),
        repoPath: process.cwd(),
      });
      console.log(`grove initialized at ${grovePaths().root}`);
      console.log(`${result.isGitRepo ? "✓" : "✗"} current directory is a git repo`);
      for (const c of result.doctor.checks) {
        console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
      }
      console.log(result.ok ? "\nReady." : "\nSetup incomplete — see above.");
      return result.ok ? 0 : 1;
    }
```

Update the usage string in `printUsage`:
```typescript
  console.log("grove — usage: grove [init | doctor | --version]");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test test/cli/index.init.test.ts`
Expected: PASS — 1 pass.

- [ ] **Step 5: Run the full suite, typecheck, and build smoke test**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test && bun run typecheck && bun run build && ./dist/grove init`
Expected: all tests PASS; `tsc --noEmit` clean; binary builds; `./dist/grove init` creates `~/.grove` (or prints setup status) and exits.

> Caution: `./dist/grove init` writes to the real `~/.grove` (no `GROVE_HOME` set). That's expected for the smoke test — it's idempotent. To avoid touching home, run `GROVE_HOME=/tmp/grove-smoke ./dist/grove init` instead.

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts test/cli/index.init.test.ts
git commit -m "feat: wire init command into the CLI"
```

---

## Self-Review (completed during planning)

**Spec coverage (Plan 2a slice of §5.1 + §8):**
- `WorktreeManager` (§5.1): create/remove/list/getDiff → Tasks 3–5 ✓; worktree path + `grove/<id>-<slug>` branch off HEAD ✓; repo = cwd (Task 9 passes `process.cwd()`) ✓
- Typed git wrapper "shell out via a small typed wrapper, mockable" (§5) → `GitRunner` Task 2 ✓
- `DiskMonitor` advisory: free space + grove-owned usage + thresholds (§8.1, §8.2) → Tasks 6–7 ✓; default warn/block from `GroveConfig` (Plan 1) consumed by callers ✓
- `init` preflight (§1, §9): create `~/.grove`, validate git repo, run doctor → Tasks 8–9 ✓
- Every boundary is an interface (`WorktreeManager`, `DiskMonitor`) with a shell-backed adapter → ✓

**Intentionally deferred to Plan 2b (not gaps):** `ComposeManager`, `InfraManager` facade (provision/teardown, teardown-on-finish), `grove gc`, dynamic port allocation, and Docker-owned disk accounting. `DiskMonitor.groveUsageBytes` covers worktree/data-dir size now; Docker volume/image accounting is a Plan 2b refinement. The engine wiring that *consumes* `DiskMonitor` at provisioning gates arrives with the Task Engine (Plan 4).

**Placeholder scan:** none — every code/test step is complete.

**Type consistency:** `GitRunner.git(args)`/`isGitRepo()`, `WorktreeManager` returns `Worktree { taskId, worktreePath, branch }`, `DiskMonitor` `freeBytes`/`evaluate`/`groveUsageBytes` with `DiskVerdict`/`DiskThresholds`, and `runInit(InitOptions) → InitResult` are defined once and used consistently across tasks and the CLI wiring. `GROVE_HOME` override is introduced in Task 9 and used by both the CLI and its test.
