import { test, expect } from "bun:test";
import { HeuristicRouter } from "../../src/engine/router.ts";

test("classifies bug-fix prose as debug", async () => {
  const r = new HeuristicRouter();
  const out = await r.classify("the login page is broken and throws an error");
  expect(out.kind).toBe("debug");
  expect(out.confidence).toBeGreaterThan(0.5);
  expect(out.reasoning.length).toBeGreaterThan(0);
});

test("classifies build prose as task", async () => {
  const r = new HeuristicRouter();
  const out = await r.classify("add a settings page with a dark mode toggle");
  expect(out.kind).toBe("task");
});

test("matches debug signals case-insensitively", async () => {
  const r = new HeuristicRouter();
  expect((await r.classify("FIX the crash on startup")).kind).toBe("debug");
  expect((await r.classify("Add a feature")).kind).toBe("task");
});

test("confidence stays within [0,1]", async () => {
  const r = new HeuristicRouter();
  const out = await r.classify("fix bug error crash broken failing regression");
  expect(out.confidence).toBeLessThanOrEqual(1);
  expect(out.confidence).toBeGreaterThanOrEqual(0);
});
