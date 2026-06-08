import { test, expect } from "bun:test";
import { buildEngine, ok } from "./helpers.ts";

test("getStatus returns null for an unknown task", () => {
  const { engine } = buildEngine(ok());
  expect(engine.getStatus("task_nope")).toBeNull();
});

test("subscribe returns an unsubscribe function", () => {
  const { engine } = buildEngine(ok());
  const off = engine.subscribe("task_1", () => {});
  expect(typeof off).toBe("function");
  off();
});
