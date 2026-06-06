import { test, expect } from "bun:test";
import { newId } from "../../src/domain/ids.ts";

test("newId returns a prefixed id", () => {
  const id = newId("task");
  expect(id.startsWith("task_")).toBe(true);
  expect(id.length).toBeGreaterThan("task_".length);
});

test("newId returns unique ids", () => {
  const a = newId("task");
  const b = newId("task");
  expect(a).not.toBe(b);
});
