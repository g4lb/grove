import { test, expect } from "bun:test";
import { SqliteStore } from "../../src/store/sqlite-store.ts";

function makeStore() {
  return SqliteStore.open(":memory:", { now: () => "2026-06-06T00:00:00.000Z" });
}

test("createPhaseRun defaults state to pending and round-trips", () => {
  const store = makeStore();
  const task = store.createTask({ title: "x", kind: "task", repoPath: "/r" });
  const run = store.createPhaseRun({ taskId: task.id, phase: "brainstorm" });
  expect(run.id.startsWith("run_")).toBe(true);
  expect(run.taskId).toBe(task.id);
  expect(run.phase).toBe("brainstorm");
  expect(run.state).toBe("pending");
  expect(run.summary).toBeNull();
  store.close();
});

test("updatePhaseRun applies a patch", () => {
  const store = makeStore();
  const task = store.createTask({ title: "x", kind: "task", repoPath: "/r" });
  const run = store.createPhaseRun({ taskId: task.id, phase: "brainstorm" });
  const updated = store.updatePhaseRun(run.id, {
    state: "succeeded",
    summary: "design done",
    artifactPath: "/r/design.md",
    endedAt: "2026-06-06T01:00:00.000Z",
  });
  expect(updated.state).toBe("succeeded");
  expect(updated.summary).toBe("design done");
  expect(updated.artifactPath).toBe("/r/design.md");
  expect(updated.endedAt).toBe("2026-06-06T01:00:00.000Z");
  store.close();
});

test("updatePhaseRun throws for unknown id", () => {
  const store = makeStore();
  expect(() => store.updatePhaseRun("run_nope", { state: "failed" })).toThrow();
  store.close();
});

test("getPhaseRuns returns runs for a task in creation order", () => {
  const store = makeStore();
  const task = store.createTask({ title: "x", kind: "task", repoPath: "/r" });
  store.createPhaseRun({ taskId: task.id, phase: "brainstorm" });
  store.createPhaseRun({ taskId: task.id, phase: "plan" });
  const runs = store.getPhaseRuns(task.id);
  expect(runs.length).toBe(2);
  expect(runs[0]!.phase).toBe("brainstorm");
  expect(runs[1]!.phase).toBe("plan");
  store.close();
});
