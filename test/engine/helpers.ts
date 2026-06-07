import { SqliteStore } from "../../src/store/sqlite-store.ts";
import { FakeAgentRunner, type FakeSession, ok, fail } from "../../src/agent/fake-agent-runner.ts";
import { TaskEngine } from "../../src/engine/task-engine.ts";
import type { TaskInfra, TaskProvisionResult } from "../../src/engine/task-infra.ts";

export { ok, fail };

export const SUPERPOWERS_PATH = "/sp";

export class FakeTaskInfra implements TaskInfra {
  provisioned: string[] = [];
  toreDown: Array<{ taskId: string; worktreePath: string }> = [];
  constructor(private composeStarted = false) {}
  async provision(taskId: string, _title: string): Promise<TaskProvisionResult> {
    this.provisioned.push(taskId);
    return {
      worktree: { taskId, worktreePath: "/wt", branch: `grove/${taskId}` },
      composeStarted: this.composeStarted,
    };
  }
  async teardown(taskId: string, worktreePath: string): Promise<void> {
    this.toreDown.push({ taskId, worktreePath });
  }
}

/** A StartTaskInput with the superpowers path filled in. */
export function startInput(over: { title?: string; description?: string; repoPath?: string } = {}) {
  return {
    title: over.title ?? "x",
    description: over.description,
    repoPath: over.repoPath ?? "/r",
    kind: "task" as const,
    superpowersPath: SUPERPOWERS_PATH,
  };
}

export function buildEngine(
  session: FakeSession,
  opts: { infra?: FakeTaskInfra } = {},
) {
  const store = SqliteStore.open(":memory:", { now: () => "2026-06-06T00:00:00.000Z" });
  const agent = new FakeAgentRunner(session);
  const infra = opts.infra ?? new FakeTaskInfra();
  const engine = new TaskEngine({ store, agent, infra, model: "claude-opus-4-8", now: () => "2026-06-06T00:00:00.000Z" });
  return { store, agent, infra, engine };
}
