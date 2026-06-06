import { test, expect } from "bun:test";
import { buildEngine, ok } from "./helpers.ts";

test("listTasks returns all created tasks", async () => {
  const { engine } = buildEngine({ brainstorm: ok("brainstorm", "/wt/.grove/design.md") });
  await engine.startTask({ title: "first task", repoPath: "/r", kind: "task" });
  await engine.startTask({ title: "second task", repoPath: "/r", kind: "task" });

  const tasks = engine.listTasks();
  expect(tasks.length).toBe(2);
  const titles = tasks.map((t) => t.title);
  expect(titles).toContain("first task");
  expect(titles).toContain("second task");
});

test("listTasks is empty before any task is created", () => {
  const { engine } = buildEngine({ brainstorm: ok("brainstorm", "/wt/.grove/design.md") });
  expect(engine.listTasks()).toEqual([]);
});
