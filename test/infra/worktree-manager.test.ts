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
  const runner = new ScriptedRunner(() => OK());
  const git = new GitRunner(runner, "/repo");
  const mgr = new GitWorktreeManager(git, paths);

  const result = await mgr.create("task_1234abcd", "Add OAuth Login");

  expect(result.branch).toBe("grove/1234abcd-add-oauth-login");
  expect(result.worktreePath).toBe("/groveroot/tasks/task_1234abcd/worktree");

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
  expect(call).toEqual([
    "-C",
    "/repo",
    "-C",
    "/groveroot/tasks/task_1234abcd/worktree",
    "diff",
    "HEAD",
  ]);
});
