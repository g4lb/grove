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

test("newId uses a full uuid suffix for collision resistance", () => {
  const id = newId("task");
  const suffix = id.slice("task_".length);
  // full UUID v4: 8-4-4-4-12 hex with dashes
  expect(suffix).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
