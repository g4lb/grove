import { test, expect } from "bun:test";
import { buildEngine, ok, FakeTaskInfra } from "./helpers.ts";

function fullScripts() {
  return {
    brainstorm: ok("brainstorm", "/wt/.grove/design.md"),
    plan: ok("plan", "/wt/.grove/plan.md"),
    execute: ok("execute", null),
    review: ok("review", "/wt/.grove/review.md"),
    finish: ok("finish", null),
  };
}

test("approve at the brainstorm gate runs plan and pauses at the plan gate", async () => {
  const { engine } = buildEngine(fullScripts());
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  const t1 = await engine.confirmGate(t0.id, { kind: "approve" });
  expect(t1.currentPhase).toBe("plan");
  expect(t1.status).toBe("waiting_confirm");
});

test("approve at the plan gate runs execute+review and pauses before finish (at review)", async () => {
  const { engine, agent } = buildEngine(fullScripts());
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  await engine.confirmGate(t0.id, { kind: "approve" }); // -> plan gate
  const t2 = await engine.confirmGate(t0.id, { kind: "approve" }); // runs execute + review
  expect(t2.currentPhase).toBe("review");
  expect(t2.status).toBe("waiting_confirm");
  expect(agent.calls.map((c) => c.phase)).toEqual(["brainstorm", "plan", "execute", "review"]);
});

test("approve at the review (before-finish) gate runs finish, tears down, and completes", async () => {
  const infra = new FakeTaskInfra();
  const { engine } = buildEngine(fullScripts(), { infra });
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  await engine.confirmGate(t0.id, { kind: "approve" }); // plan gate
  await engine.confirmGate(t0.id, { kind: "approve" }); // review gate
  const done = await engine.confirmGate(t0.id, { kind: "approve" }); // finish
  expect(done.status).toBe("done");
  expect(done.currentPhase).toBe("finish");
  expect(infra.toreDown).toEqual([{ taskId: t0.id, worktreePath: "/wt" }]);
});

test("approve throws if the task is not at a gate", async () => {
  const { engine } = buildEngine(fullScripts());
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  await engine.confirmGate(t0.id, { kind: "approve" });
  await engine.confirmGate(t0.id, { kind: "approve" });
  await engine.confirmGate(t0.id, { kind: "approve" }); // done
  await expect(engine.confirmGate(t0.id, { kind: "approve" })).rejects.toThrow();
});
