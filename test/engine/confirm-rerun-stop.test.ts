import { test, expect } from "bun:test";
import { buildEngine, ok } from "./helpers.ts";

test("rerun re-runs the current phase with feedback and pauses again at the same gate", async () => {
  const { engine, agent, store } = buildEngine({
    brainstorm: ok("brainstorm", "/wt/.grove/design.md"),
  });
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  const t1 = await engine.confirmGate(t0.id, { kind: "rerun", feedback: "try harder" });

  expect(t1.currentPhase).toBe("brainstorm");
  expect(t1.status).toBe("waiting_confirm");
  expect(agent.calls.filter((c) => c.phase === "brainstorm").length).toBe(2);
  expect(store.getPhaseRuns(t0.id).filter((r) => r.phase === "brainstorm").length).toBe(2);
});

test("stop sets status to stopped (resumable) without running anything", async () => {
  const { engine, agent } = buildEngine({ brainstorm: ok("brainstorm", "/wt/.grove/design.md") });
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  const callsBefore = agent.calls.length;
  const stopped = await engine.confirmGate(t0.id, { kind: "stop" });
  expect(stopped.status).toBe("stopped");
  expect(agent.calls.length).toBe(callsBefore);
});
