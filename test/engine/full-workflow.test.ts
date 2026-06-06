import { test, expect } from "bun:test";
import { buildEngine, ok, FakeTaskInfra } from "./helpers.ts";

test("a task runs start -> 3 gates -> done with all phases and teardown", async () => {
  const infra = new FakeTaskInfra();
  const { engine, agent, store } = buildEngine(
    {
      brainstorm: ok("brainstorm", "/wt/.grove/design.md"),
      plan: ok("plan", "/wt/.grove/plan.md"),
      execute: ok("execute", null),
      review: ok("review", "/wt/.grove/review.md"),
      finish: ok("finish", null),
    },
    { infra },
  );

  const t0 = await engine.startTask({ title: "Add OAuth login", description: "Google", repoPath: "/repo", kind: "task" });
  expect(t0.status).toBe("waiting_confirm");
  expect(t0.currentPhase).toBe("brainstorm");

  const t1 = await engine.confirmGate(t0.id, { kind: "approve" });
  expect(t1.currentPhase).toBe("plan");
  expect(t1.status).toBe("waiting_confirm");

  const t2 = await engine.confirmGate(t0.id, { kind: "approve" });
  expect(t2.currentPhase).toBe("review");
  expect(t2.status).toBe("waiting_confirm");

  const t3 = await engine.confirmGate(t0.id, { kind: "approve" });
  expect(t3.status).toBe("done");

  expect(agent.calls.map((c) => c.phase)).toEqual(["brainstorm", "plan", "execute", "review", "finish"]);
  const runs = store.getPhaseRuns(t0.id);
  expect(runs.length).toBe(5);
  expect(runs.every((r) => r.state === "succeeded")).toBe(true);
  expect(infra.toreDown).toEqual([{ taskId: t0.id, worktreePath: "/wt" }]);
});
