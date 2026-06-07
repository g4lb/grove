import { test, expect } from "bun:test";
import { resolveClaudePath } from "../../src/agent/claude-binary.ts";

function deps(over: Partial<Parameters<typeof resolveClaudePath>[0]> = {}) {
  return {
    env: {} as Record<string, string | undefined>,
    runtimeDir: "/home/.grove/runtime",
    isExecutable: () => false,
    whichClaude: () => null,
    ...over,
  };
}

test("prefers $GROVE_CLAUDE_PATH when it is executable", () => {
  const p = resolveClaudePath(deps({ env: { GROVE_CLAUDE_PATH: "/custom/claude" }, isExecutable: (x) => x === "/custom/claude" }));
  expect(p).toBe("/custom/claude");
});

test("falls back to the runtime dir when no env override", () => {
  const p = resolveClaudePath(deps({ isExecutable: (x) => x === "/home/.grove/runtime/claude" }));
  expect(p).toBe("/home/.grove/runtime/claude");
});

test("falls back to PATH (whichClaude) when neither env nor runtime dir", () => {
  const p = resolveClaudePath(deps({ whichClaude: () => "/usr/local/bin/claude", isExecutable: (x) => x === "/usr/local/bin/claude" }));
  expect(p).toBe("/usr/local/bin/claude");
});

test("returns null when nothing resolves", () => {
  expect(resolveClaudePath(deps())).toBe(null);
});

test("precedence: env over runtime over PATH", () => {
  const p = resolveClaudePath(deps({
    env: { GROVE_CLAUDE_PATH: "/a/claude" },
    whichClaude: () => "/c/claude",
    isExecutable: () => true,
  }));
  expect(p).toBe("/a/claude");
});

test("ignores a non-executable env override and continues down the chain", () => {
  const p = resolveClaudePath(deps({
    env: { GROVE_CLAUDE_PATH: "/missing/claude" },
    isExecutable: (x) => x === "/home/.grove/runtime/claude",
  }));
  expect(p).toBe("/home/.grove/runtime/claude");
});
