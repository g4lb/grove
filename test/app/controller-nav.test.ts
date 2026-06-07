import { test, expect } from "bun:test";
import { TaskRunController, type ControllerEngine } from "../../src/app/controller.ts";
import type { Task } from "../../src/domain/types.ts";

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

const noEngine: ControllerEngine = {
  async startTask() {
    throw new Error("should not run");
  },
};

function ctl(tasks: Task[], engine: ControllerEngine = noEngine) {
  const c = new TaskRunController(engine, "/repo", "/sp");
  c.setLister(() => tasks);
  return c;
}

test("submit('/list') switches to list mode and loads tasks", async () => {
  const tasks = [task({ id: "task_1", title: "one" }), task({ id: "task_2", title: "two" })];
  const c = ctl(tasks);
  await c.submit("/list");
  const v = c.snapshot();
  expect(v.mode).toBe("list");
  expect(v.tasks.map((t) => t.id)).toEqual(["task_1", "task_2"]);
  expect(v.selected).toBe(0);
});

test("selectDown/selectUp move the selection within bounds", async () => {
  const c = ctl([task({ id: "a" }), task({ id: "b" }), task({ id: "c" })]);
  await c.submit("/list");
  c.selectDown();
  c.selectDown();
  c.selectDown();
  expect(c.snapshot().selected).toBe(2);
  c.selectUp();
  expect(c.snapshot().selected).toBe(1);
  c.selectUp();
  c.selectUp();
  expect(c.snapshot().selected).toBe(0);
});

test("openSelected opens the highlighted task into the run view", async () => {
  const t = task({ id: "task_42", title: "build it", status: "blocked" });
  const c = ctl([t]);
  await c.submit("/list");
  c.openSelected();
  const v = c.snapshot();
  expect(v.mode).toBe("prompt");
  expect(v.task?.id).toBe("task_42");
  expect(v.state).toBe("blocked");
});

test("submit('/open <id>') opens that task directly", async () => {
  const t = task({ id: "task_7", title: "seven", status: "blocked" });
  const c = ctl([t]);
  await c.submit("/open task_7");
  const v = c.snapshot();
  expect(v.mode).toBe("prompt");
  expect(v.task?.id).toBe("task_7");
  expect(v.state).toBe("blocked");
});

test("submit('/open <unknown>') reports not found and stays put", async () => {
  const c = ctl([task({ id: "task_1" })]);
  await c.submit("/open nope");
  expect(c.snapshot().feed.join("\n").toLowerCase()).toContain("not found");
});

test("backToPrompt returns to an idle prompt", async () => {
  const c = ctl([task({ id: "a" })]);
  await c.submit("/list");
  c.backToPrompt();
  const v = c.snapshot();
  expect(v.mode).toBe("prompt");
  expect(v.state).toBe("idle");
});

test("submit(prose) runs it as a task (not a command)", async () => {
  let started = false;
  const engine: ControllerEngine = {
    async startTask() {
      started = true;
      return task({ id: "task_1", status: "done" });
    },
  };
  const c = ctl([], engine);
  await c.submit("add a settings page");
  expect(started).toBe(true);
  expect(c.snapshot().state).toBe("done");
});

test("opening a task marks the view as 'viewing'", async () => {
  const c = ctl([task({ id: "task_1", status: "running" })]);
  await c.submit("/open task_1");
  expect(c.snapshot().viewing).toBe(true);
});

test("backToPrompt clears viewing", async () => {
  const c = ctl([task({ id: "task_1", status: "running" })]);
  await c.submit("/open task_1");
  c.backToPrompt();
  expect(c.snapshot().viewing).toBe(false);
});

test("starting a fresh task is not in viewing mode", async () => {
  const engine: ControllerEngine = {
    async startTask() {
      return task({ id: "task_1", status: "done" });
    },
  };
  const c = ctl([], engine);
  await c.submit("add a page");
  expect(c.snapshot().viewing).toBe(false);
});
