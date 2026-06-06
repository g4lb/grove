import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
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

  const list = await mgr.list();
  expect(list.some((p) => p.endsWith("/task_abcd1234/worktree"))).toBe(true);

  writeFileSync(join(wt.worktreePath, "README.md"), "hello\nworld\n");
  const diff = await mgr.getDiff("task_abcd1234");
  expect(diff).toContain("+world");

  await mgr.remove("task_abcd1234");
  const after = await mgr.list();
  expect(after.some((p) => p.endsWith("/task_abcd1234/worktree"))).toBe(false);
});

test("getDiff includes newly created (untracked) files", async () => {
  const paths = resolvePaths(groveRoot);
  const git = new GitRunner(new BunCommandRunner(), repo);
  const mgr = new GitWorktreeManager(git, paths);

  const wt = await mgr.create("task_newfile1", "New File");
  // create a brand-new, untracked file in the worktree
  writeFileSync(join(wt.worktreePath, "NEWFILE.txt"), "brand new content\n");

  const diff = await mgr.getDiff("task_newfile1");
  expect(diff).toContain("NEWFILE.txt");
  expect(diff).toContain("brand new content");

  await mgr.remove("task_newfile1");
});

test("remove is idempotent and cleans the task dir (gc can run twice without error)", async () => {
  const paths = resolvePaths(groveRoot);
  const git = new GitRunner(new BunCommandRunner(), repo);
  const mgr = new GitWorktreeManager(git, paths);

  const wt = await mgr.create("task_twice1", "Twice");
  expect(existsSync(wt.worktreePath)).toBe(true);

  await mgr.remove("task_twice1");
  // both the worktree AND its parent task dir must be gone, so gc discovery
  // won't rediscover an empty task_ dir and re-orphan it.
  expect(existsSync(wt.worktreePath)).toBe(false);
  expect(existsSync(paths.taskDir("task_twice1"))).toBe(false);

  // second remove must NOT throw — this is the exact idempotency bug that made
  // `grove gc` exit 1 on every run after the first reclamation.
  await mgr.remove("task_twice1");
  expect(existsSync(paths.taskDir("task_twice1"))).toBe(false);
});
