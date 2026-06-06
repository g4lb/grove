import { test, expect } from "bun:test";
import { buildEngine, ok } from "./helpers.ts";

test("resume on a stopped task re-runs the current phase forward", async () => {
  const { engine, store } = buildEngine({
    brainstorm: ok("brainstorm", "/wt/.grove/design.md"),
  });
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" }); // brainstorm gate
  await engine.confirmGate(t0.id, { kind: "stop" }); // stopped
  expect(store.getTask(t0.id)!.status).toBe("stopped");

  const resumed = await engine.resume(t0.id);
  expect(resumed.status).toBe("waiting_confirm");
  expect(resumed.currentPhase).toBe("brainstorm");
});

test("resume on a waiting_confirm task is a no-op (still awaiting the gate)", async () => {
  const { engine } = buildEngine({ brainstorm: ok("brainstorm", "/wt/.grove/design.md") });
  const t0 = await engine.startTask({ title: "x", repoPath: "/r", kind: "task" });
  const resumed = await engine.resume(t0.id);
  expect(resumed.status).toBe("waiting_confirm");
  expect(resumed.currentPhase).toBe("brainstorm");
});
