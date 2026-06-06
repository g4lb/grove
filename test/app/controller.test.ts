import { test, expect } from "bun:test";
import { TaskRunController, type ControllerEngine } from "../../src/app/controller.ts";
import { HeuristicRouter } from "../../src/engine/router.ts";
import type { Task } from "../../src/domain/types.ts";
import type { AgentEvent } from "../../src/agent/events.ts";
import type { GateDecision } from "../../src/engine/task-engine.ts";

function task(over: Partial<Task>): Task {
  return {
    id: "task_1",
    title: "x",
    description: null,
    kind: "task",
    status: "waiting_confirm",
    currentPhase: "brainstorm",
    repoPath: "/r",
    worktreePath: "/wt",
    branch: "grove/task_1",
    composeProject: null,
    createdAt: "t",
    updatedAt: "t",
    ...over,
  };
}

function fakeEngine(states: Task[], events: AgentEvent[][]): ControllerEngine {
  let i = 0;
  return {
    async startTask(_input, onEvent) {
      (events[i] ?? []).forEach((e) => onEvent?.(e));
      return states[i++]!;
    },
    async confirmGate(_id, _d: GateDecision, onEvent) {
      (events[i] ?? []).forEach((e) => onEvent?.(e));
      return states[i++]!;
    },
  };
}

test("start classifies, runs, accumulates events, and reaches the gate", async () => {
  const engine = fakeEngine(
    [task({ status: "waiting_confirm", currentPhase: "brainstorm" })],
    [[{ type: "notice", message: "phase brainstorm started" }, { type: "tool_use", tool: "Write", input: {} }]],
  );
  const c = new TaskRunController(engine, new HeuristicRouter(), "/repo");
  await c.start("add a settings page");
  const v = c.snapshot();
  expect(v.state).toBe("waiting_confirm");
  expect(v.feed.join("\n")).toContain("Write");
  expect(v.message.toLowerCase()).toContain("gate");
});

test("decide approve advances to done", async () => {
  const engine = fakeEngine(
    [task({ status: "waiting_confirm", currentPhase: "brainstorm" }), task({ status: "done", currentPhase: "finish" })],
    [[], []],
  );
  const c = new TaskRunController(engine, new HeuristicRouter(), "/repo");
  await c.start("add a page");
  await c.decide({ kind: "approve" });
  expect(c.snapshot().state).toBe("done");
  expect(c.snapshot().message.toLowerCase()).toContain("complete");
});

test("decide stop stops the task", async () => {
  const engine = fakeEngine(
    [task({ status: "waiting_confirm", currentPhase: "brainstorm" }), task({ status: "stopped", currentPhase: "brainstorm" })],
    [[], []],
  );
  const c = new TaskRunController(engine, new HeuristicRouter(), "/repo");
  await c.start("add a page");
  await c.decide({ kind: "stop" });
  expect(c.snapshot().state).toBe("stopped");
});

test("a debug-classified request is noted in the feed", async () => {
  const engine = fakeEngine([task({ status: "done", currentPhase: "finish" })], [[]]);
  const c = new TaskRunController(engine, new HeuristicRouter(), "/repo");
  await c.start("fix the broken login");
  expect(c.snapshot().feed.join("\n").toLowerCase()).toContain("debug");
});

test("onChange fires when state changes", async () => {
  const engine = fakeEngine([task({ status: "done", currentPhase: "finish" })], [[{ type: "notice", message: "x" }]]);
  const c = new TaskRunController(engine, new HeuristicRouter(), "/repo");
  let changes = 0;
  c.onChange = () => {
    changes++;
  };
  await c.start("add a page");
  expect(changes).toBeGreaterThan(0);
});

test("start surfaces an engine error as blocked (does not hang on running)", async () => {
  const engine: ControllerEngine = {
    async startTask() {
      throw new Error("provision failed: docker down");
    },
    async confirmGate() {
      throw new Error("unused");
    },
  };
  const c = new TaskRunController(engine, new HeuristicRouter(), "/repo");
  await c.start("add a page");
  const v = c.snapshot();
  expect(v.state).toBe("blocked");
  expect(v.message.toLowerCase()).toContain("fail");
});

test("decide surfaces a confirmGate error as blocked", async () => {
  let calls = 0;
  const engine: ControllerEngine = {
    async startTask() {
      return task({ status: "waiting_confirm", currentPhase: "brainstorm" });
    },
    async confirmGate() {
      calls++;
      throw new Error("cannot approve a completed task");
    },
  };
  const c = new TaskRunController(engine, new HeuristicRouter(), "/repo");
  await c.start("add a page");
  await c.decide({ kind: "approve" });
  expect(c.snapshot().state).toBe("blocked");
  expect(calls).toBe(1);
});

test("decide is a no-op while a run is already in flight (no double-fire)", async () => {
  let calls = 0;
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => (release = r));
  const engine: ControllerEngine = {
    async startTask() {
      return task({ status: "waiting_confirm", currentPhase: "brainstorm" });
    },
    async confirmGate() {
      calls++;
      await gate;
      return task({ status: "done", currentPhase: "finish" });
    },
  };
  const c = new TaskRunController(engine, new HeuristicRouter(), "/repo");
  await c.start("add a page");
  const p1 = c.decide({ kind: "approve" }); // enters running, awaits gate
  const p2 = c.decide({ kind: "approve" }); // should be a no-op (already running)
  release!();
  await Promise.all([p1, p2]);
  expect(calls).toBe(1);
});
