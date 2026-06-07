import { test, expect } from "bun:test";
import { buildEngine, startInput, ok, fail, SUPERPOWERS_PATH } from "./helpers.ts";

test("startTask provisions, runs the session, and completes done", async () => {
  const { engine, infra } = buildEngine(ok("done", [{ type: "token", text: "hi" }]));

  const task = await engine.startTask(startInput({ title: "Add login", description: "OAuth" }));

  expect(task.status).toBe("done");
  expect(task.currentPhase).toBe("session");
  expect(task.worktreePath).toBe("/wt");
  expect(task.branch).toBe(`grove/${task.id}`);
  expect(infra.provisioned).toEqual([task.id]);
  expect(infra.toreDown).toEqual([{ taskId: task.id, worktreePath: "/wt" }]);
});

test("a failed session moves the task to blocked (and does not teardown)", async () => {
  const { engine, infra } = buildEngine(fail("nope"));
  const task = await engine.startTask(startInput());
  expect(task.status).toBe("blocked");
  expect(task.currentPhase).toBe("session");
  expect(infra.toreDown).toEqual([]);
});

test("startTask records one phase_run and streams events to the store", async () => {
  const { engine, store } = buildEngine(
    ok("done", [{ type: "token", text: "hi" }, { type: "tool_use", tool: "Write", input: {} }]),
  );

  const task = await engine.startTask(startInput());

  const events = store.getEvents(task.id);
  expect(events.some((e) => e.type === "provisioned")).toBe(true);
  expect(events.some((e) => e.type === "agent:token")).toBe(true);
  expect(events.some((e) => e.type === "agent:tool_use")).toBe(true);

  const runs = store.getPhaseRuns(task.id);
  expect(runs.length).toBe(1);
  expect(runs[0]!.phase).toBe("session");
  expect(runs[0]!.state).toBe("succeeded");
});

test("startTask passes the superpowers path and prose into the session context", async () => {
  const { engine, agent } = buildEngine(ok());
  await engine.startTask(startInput({ title: "Add login", description: "support Google OAuth" }));
  expect(agent.contexts.length).toBe(1);
  expect(agent.contexts[0]!.superpowersPath).toBe(SUPERPOWERS_PATH);
  expect(agent.contexts[0]!.prose).toBe("support Google OAuth");
  expect(agent.contexts[0]!.branch).toMatch(/^grove\//);
});

test("when no description is given the title is used as the prose", async () => {
  const { engine, agent } = buildEngine(ok());
  await engine.startTask(startInput({ title: "just the title" }));
  expect(agent.contexts[0]!.prose).toBe("just the title");
});

test("the task description is persisted on the task row", async () => {
  const { engine, store } = buildEngine(ok());
  const t = await engine.startTask(startInput({ title: "Add login", description: "support Google OAuth" }));
  expect(store.getTask(t.id)!.description).toBe("support Google OAuth");
});
