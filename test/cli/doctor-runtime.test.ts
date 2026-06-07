import { test, expect } from "bun:test";
import { checkClaudeRuntime } from "../../src/cli/doctor.ts";

test("ok when the binary resolves and the marker version matches", () => {
  const c = checkClaudeRuntime({ resolve: () => "/home/.grove/runtime/claude", installedVersion: () => "0.3.167", expected: "0.3.167" });
  expect(c.ok).toBe(true);
  expect(c.detail).toContain("0.3.167");
});

test("fails with an install hint when the binary is missing", () => {
  const c = checkClaudeRuntime({ resolve: () => null, installedVersion: () => null, expected: "0.3.167" });
  expect(c.ok).toBe(false);
  expect(c.detail.toLowerCase()).toContain("install-runtime");
});

test("warns (still ok) on a version mismatch", () => {
  const c = checkClaudeRuntime({ resolve: () => "/home/.grove/runtime/claude", installedVersion: () => "0.3.100", expected: "0.3.167" });
  expect(c.ok).toBe(true);
  expect(c.detail.toLowerCase()).toContain("mismatch");
});
