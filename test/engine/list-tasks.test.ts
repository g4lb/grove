import { test, expect } from "bun:test";
import { buildEngine, startInput, ok } from "./helpers.ts";

test("listTasks returns all created tasks", async () => {
  const { engine } = buildEngine(ok());
  await engine.startTask(startInput({ title: "first task" }));
  await engine.startTask(startInput({ title: "second task" }));

  const tasks = engine.listTasks();
  expect(tasks.length).toBe(2);
  const titles = tasks.map((t) => t.title);
  expect(titles).toContain("first task");
  expect(titles).toContain("second task");
});

test("listTasks is empty before any task is created", () => {
  const { engine } = buildEngine(ok());
  expect(engine.listTasks()).toEqual([]);
});
