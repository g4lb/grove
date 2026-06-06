import { test, expect } from "bun:test";
import { SqliteStore } from "../../src/store/sqlite-store.ts";
import { TaskEngine } from "../../src/engine/task-engine.ts";
import { ok } from "./helpers.ts";
import type { TaskInfra, TaskProvisionResult } from "../../src/engine/task-infra.ts";

// Infra whose teardown always throws.
class ThrowingTeardownInfra implements TaskInfra {
  async provision(taskId: string): Promise<TaskProvisionResult> {
    return { worktree: { taskId, worktreePath: "/wt", branch: `grove/${taskId}` }, composeStarted: false };
  }
  async teardown(): Promise<void> {
    throw new Error("docker down failed");
  }
}

function fullEngine() {
  const store = SqliteStore.open(":memory:", { now: () => "t" });
  const agent = new (require("../../src/agent/fake-agent-runner.ts").FakeAgentRunner)({
    brainstorm: ok("brainstorm", "/wt/.grove/design.md"),
    plan: ok("plan", "/wt/.grove/plan.md"),
    execute: ok("execute", null),
    review: ok("review", "/wt/.grove/review.md"),
    finish: ok("finish", null),
  });
  const engine = new TaskEngine({ store, agent, infra: new ThrowingTeardownInfra(), model: "m", now: () => "t" });
  return { store, engine };
}

test("a failing teardown still completes the task to done (does not propagate, no stuck-running)", async () => {
  const { engine } = fullEngine();
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  await engine.confirmGate(t0.id, { kind: "approve" }); // plan
  await engine.confirmGate(t0.id, { kind: "approve" }); // review
  // the final approve runs finish + teardown(throws) — must NOT reject, must end "done"
  const done = await engine.confirmGate(t0.id, { kind: "approve" });
  expect(done.status).toBe("done");
});
