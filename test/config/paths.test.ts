import { test, expect } from "bun:test";
import { resolvePaths } from "../../src/config/paths.ts";

test("resolvePaths derives the grove layout from a root", () => {
  const p = resolvePaths("/tmp/groveroot");
  expect(p.root).toBe("/tmp/groveroot");
  expect(p.dbFile).toBe("/tmp/groveroot/grove.db");
  expect(p.tasksDir).toBe("/tmp/groveroot/tasks");
  expect(p.configFile).toBe("/tmp/groveroot/config.json");
  expect(p.taskDir("task_123")).toBe("/tmp/groveroot/tasks/task_123");
});
