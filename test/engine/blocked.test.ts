import { test, expect } from "bun:test";
import { buildEngine, ok, fail } from "./helpers.ts";

test("a failed phase moves the task to blocked (no gate, no advance)", async () => {
  const { engine } = buildEngine({
    brainstorm: ok("brainstorm", "/wt/.grove/design.md"),
    plan: fail("plan"),
  });
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  const blocked = await engine.confirmGate(t0.id, { kind: "approve" }); // runs plan -> fails
  expect(blocked.status).toBe("blocked");
  expect(blocked.currentPhase).toBe("plan");
});

test("rerun (no feedback) retries a blocked phase; it is attempted again", async () => {
  const { engine, agent } = buildEngine({
    brainstorm: ok("brainstorm", "/wt/.grove/design.md"),
    plan: fail("plan"),
  });
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  await engine.confirmGate(t0.id, { kind: "approve" }); // plan fails -> blocked
  const after = await engine.confirmGate(t0.id, { kind: "rerun" }); // retry plan (still scripted to fail)
  expect(after.status).toBe("blocked");
  expect(agent.calls.filter((c) => c.phase === "plan").length).toBe(2);
});
