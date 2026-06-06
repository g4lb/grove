import { test, expect } from "bun:test";
import { buildEngine, ok } from "./helpers.ts";

test("startTask provisions, runs brainstorm, and pauses at the brainstorm gate", async () => {
  const { engine, infra } = buildEngine({
    brainstorm: ok("brainstorm", "/wt/.grove/design.md", [{ type: "token", text: "hi" }]),
  });

  const task = await engine.startTask({ title: "Add login", description: "OAuth", repoPath: "/repo", kind: "task" });

  expect(task.status).toBe("waiting_confirm");
  expect(task.currentPhase).toBe("brainstorm");
  expect(task.worktreePath).toBe("/wt");
  expect(task.branch).toBe(`grove/${task.id}`);
  expect(infra.provisioned).toEqual([task.id]);
});

test("startTask records a phase_run and streams events to the store", async () => {
  const { engine, store } = buildEngine({
    brainstorm: ok("brainstorm", "/wt/.grove/design.md", [{ type: "token", text: "hi" }, { type: "tool_use", tool: "Write", input: {} }]),
  });

  const task = await engine.startTask({ title: "x", repoPath: "/repo", kind: "task" });

  const events = store.getEvents(task.id);
  expect(events.some((e) => e.type === "provisioned")).toBe(true);
  expect(events.some((e) => e.type === "agent:token")).toBe(true);
  expect(events.some((e) => e.type === "agent:tool_use")).toBe(true);

  const runs = store.getPhaseRuns(task.id);
  expect(runs.length).toBe(1);
  expect(runs[0]!.phase).toBe("brainstorm");
  expect(runs[0]!.state).toBe("succeeded");
  expect(runs[0]!.artifactPath).toBe("/wt/.grove/design.md");
});
