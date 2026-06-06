import { test, expect } from "bun:test";
import { SqliteStore } from "../../src/store/sqlite-store.ts";
import { TaskEngine } from "../../src/engine/task-engine.ts";
import { FakeTaskInfra } from "./helpers.ts";
import type { AgentRunner } from "../../src/agent/agent-runner.ts";
import type { Phase } from "../../src/domain/types.ts";
import type { AgentEvent, PhaseContext, PhaseResult } from "../../src/agent/events.ts";

class DescSpy implements AgentRunner {
  descriptions: Array<{ phase: Phase; description: string | undefined }> = [];
  async *run(phase: Phase, ctx: PhaseContext): AsyncGenerator<AgentEvent, PhaseResult> {
    this.descriptions.push({ phase, description: ctx.description });
    return { success: true, summary: "ok", artifactPath: phase === "brainstorm" ? "/wt/.grove/design.md" : null, costUsd: 0, sessionId: "s" };
  }
}

test("the task description is persisted and still reaches the agent on a rerun", async () => {
  const store = SqliteStore.open(":memory:", { now: () => "t" });
  const agent = new DescSpy();
  const engine = new TaskEngine({ store, agent, infra: new FakeTaskInfra(), model: "m", now: () => "t" });

  const t0 = await engine.startTask({ title: "Add login", description: "support Google OAuth", repoPath: "/r", kind: "task" });
  // persisted on the task row
  expect(store.getTask(t0.id)!.description).toBe("support Google OAuth");
  // first brainstorm saw it
  expect(agent.descriptions[0]).toEqual({ phase: "brainstorm", description: "support Google OAuth" });

  await engine.confirmGate(t0.id, { kind: "rerun", feedback: "again" });
  // the rerun's brainstorm STILL saw the description (previously lost)
  const lastBrainstorm = agent.descriptions.filter((d) => d.phase === "brainstorm").pop()!;
  expect(lastBrainstorm.description).toBe("support Google OAuth");
});
