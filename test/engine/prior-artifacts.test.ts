import { test, expect } from "bun:test";
import { SqliteStore } from "../../src/store/sqlite-store.ts";
import { TaskEngine } from "../../src/engine/task-engine.ts";
import { FakeTaskInfra } from "./helpers.ts";
import type { AgentRunner } from "../../src/agent/agent-runner.ts";
import type { Phase } from "../../src/domain/types.ts";
import type { AgentEvent, PhaseContext, PhaseResult } from "../../src/agent/events.ts";

// A spy runner that records each PhaseContext and returns a scripted success.
class SpyRunner implements AgentRunner {
  contexts: Array<{ phase: Phase; priorArtifacts: PhaseContext["priorArtifacts"] }> = [];
  constructor(private artifacts: Partial<Record<Phase, string | null>>) {}
  async *run(phase: Phase, ctx: PhaseContext): AsyncGenerator<AgentEvent, PhaseResult> {
    this.contexts.push({ phase, priorArtifacts: ctx.priorArtifacts });
    return {
      success: true,
      summary: `${phase} done`,
      artifactPath: this.artifacts[phase] ?? null,
      costUsd: 0,
      sessionId: "s",
    };
  }
}

test("each phase sees earlier succeeded phases' artifacts as priorArtifacts", async () => {
  const store = SqliteStore.open(":memory:", { now: () => "2026-06-06T00:00:00.000Z" });
  const agent = new SpyRunner({
    brainstorm: "/wt/.grove/design.md",
    plan: "/wt/.grove/plan.md",
    execute: null,
    review: "/wt/.grove/review.md",
    finish: null,
  });
  const engine = new TaskEngine({ store, agent, infra: new FakeTaskInfra(), model: "m", now: () => "t" });

  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  await engine.confirmGate(t0.id, { kind: "approve" }); // plan
  await engine.confirmGate(t0.id, { kind: "approve" }); // execute + review
  await engine.confirmGate(t0.id, { kind: "approve" }); // finish

  const byPhase = (p: Phase) => agent.contexts.find((c) => c.phase === p)!.priorArtifacts.map((a) => a.path);
  expect(byPhase("brainstorm")).toEqual([]);
  expect(byPhase("plan")).toEqual(["/wt/.grove/design.md"]);
  expect(byPhase("execute")).toEqual(["/wt/.grove/design.md", "/wt/.grove/plan.md"]);
  expect(byPhase("finish")).toEqual(["/wt/.grove/design.md", "/wt/.grove/plan.md", "/wt/.grove/review.md"]);
});
