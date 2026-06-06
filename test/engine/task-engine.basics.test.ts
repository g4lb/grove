import { test, expect } from "bun:test";
import { buildEngine } from "./helpers.ts";

test("getStatus returns null for an unknown task", () => {
  const { engine } = buildEngine({});
  expect(engine.getStatus("task_nope")).toBeNull();
});

test("subscribe returns an unsubscribe function", () => {
  const { engine } = buildEngine({});
  const off = engine.subscribe("task_1", () => {});
  expect(typeof off).toBe("function");
  off();
});
