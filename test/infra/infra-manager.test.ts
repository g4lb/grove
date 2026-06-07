import { test, expect } from "bun:test";
import { InfraManager } from "../../src/infra/infra-manager.ts";
import type { WorktreeManager, Worktree } from "../../src/infra/worktree-manager.ts";
import type { ComposeManager } from "../../src/infra/compose-manager.ts";

class FakeWorktrees implements WorktreeManager {
  removed: string[] = [];
  committedArgs: Array<{ worktreePath: string; branch: string; baseSha: string }> = [];
  committed = true;
  async create(taskId: string, _title: string): Promise<Worktree> {
    return { taskId, worktreePath: `/grove/tasks/${taskId}/worktree`, branch: `grove/${taskId}`, baseSha: "base000" };
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
  async committedChanges(worktreePath: string, branch: string, baseSha: string): Promise<boolean> {
    this.committedArgs.push({ worktreePath, branch, baseSha });
    return this.committed;
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
  expect(result.worktree.baseSha).toBe("base000");
  expect(compose.ups[0]).toEqual({ taskId: "task_x", wt: "/grove/tasks/task_x/worktree" });
});

test("committedChanges delegates to the worktree manager", async () => {
  const wts = new FakeWorktrees();
  const infra = new InfraManager(wts, new FakeCompose(false));
  wts.committed = false;
  expect(await infra.committedChanges("/grove/tasks/task_x/worktree", "grove/task_x", "abc")).toBe(false);
  expect(wts.committedArgs).toEqual([{ worktreePath: "/grove/tasks/task_x/worktree", branch: "grove/task_x", baseSha: "abc" }]);
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
