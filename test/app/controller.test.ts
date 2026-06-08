import { test, expect } from "bun:test";
import { TaskRunController, type ControllerEngine } from "../../src/app/controller.ts";
import type { Task } from "../../src/domain/types.ts";
import type { AgentEvent } from "../../src/agent/events.ts";
import type { StartTaskInput } from "../../src/engine/task-engine.ts";

function task(over: Partial<Task>): Task {
  return {
    id: "task_1",
    title: "x",
    description: null,
    kind: "task",
    status: "done",
    currentPhase: "session",
    repoPath: "/r",
    worktreePath: "/wt",
    branch: "grove/task_1",
    composeProject: null,
    createdAt: "t",
    updatedAt: "t",
    ...over,
  };
}

function fakeEngine(result: Task, events: AgentEvent[] = [], capture?: { input?: StartTaskInput }): ControllerEngine {
  return {
    async startTask(input, onEvent) {
      if (capture) capture.input = input;
      events.forEach((e) => onEvent?.(e));
      return result;
    },
  };
}

test("start runs a session, accumulates events, and reaches done", async () => {
  const engine = fakeEngine(
    task({ status: "done", branch: "grove/task_1" }),
    [{ type: "notice", message: "session started" }, { type: "tool_use", tool: "Write", input: {} }],
  );
  const c = new TaskRunController(engine, "/repo", "/sp");
  await c.start("add a settings page");
  const v = c.snapshot();
  expect(v.state).toBe("done");
  expect(v.feed.join("\n")).toContain("Write");
  expect(v.message.toLowerCase()).toContain("done");
});

test("start passes the prose and superpowers path into the engine", async () => {
  const capture: { input?: StartTaskInput } = {};
  const engine = fakeEngine(task({ status: "done" }), [], capture);
  const c = new TaskRunController(engine, "/repo", "/my/sp");
  await c.start("add a page");
  expect(capture.input!.superpowersPath).toBe("/my/sp");
  expect(capture.input!.description).toBe("add a page");
  expect(capture.input!.repoPath).toBe("/repo");
});

test("a blocked session is reflected in state", async () => {
  const engine = fakeEngine(task({ status: "blocked" }));
  const c = new TaskRunController(engine, "/repo", "/sp");
  await c.start("add a page");
  expect(c.snapshot().state).toBe("blocked");
});

test("onChange fires when state changes", async () => {
  const engine = fakeEngine(task({ status: "done" }), [{ type: "notice", message: "x" }]);
  const c = new TaskRunController(engine, "/repo", "/sp");
  let changes = 0;
  c.onChange = () => { changes++; };
  await c.start("add a page");
  expect(changes).toBeGreaterThan(0);
});

test("start surfaces an engine error as blocked (does not hang on running)", async () => {
  const engine: ControllerEngine = {
    async startTask() {
      throw new Error("provision failed: docker down");
    },
  };
  const c = new TaskRunController(engine, "/repo", "/sp");
  await c.start("add a page");
  const v = c.snapshot();
  expect(v.state).toBe("blocked");
  expect(v.message.toLowerCase()).toContain("fail");
});

test("start is a no-op while a run is already in flight (no double-fire)", async () => {
  let calls = 0;
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => (release = r));
  const engine: ControllerEngine = {
    async startTask() {
      calls++;
      await gate;
      return task({ status: "done" });
    },
  };
  const c = new TaskRunController(engine, "/repo", "/sp");
  const p1 = c.start("add a page");
  const p2 = c.start("add a page again"); // should be a no-op (already running)
  release!();
  await Promise.all([p1, p2]);
  expect(calls).toBe(1);
});
