import { test, expect } from "bun:test";
import { buildSessionPrompt, AUTONOMY_APPEND } from "../../src/agent/session-prompt.ts";
import type { SessionContext } from "../../src/agent/events.ts";

function ctx(over: Partial<SessionContext> = {}): SessionContext {
  return { taskId: "t", title: "x", prose: "add a /health endpoint", worktreePath: "/wt", branch: "grove/t", model: "m", superpowersPath: "/sp", ...over };
}

test("prompt includes the task, the branch, and autonomous instructions", () => {
  const p = buildSessionPrompt(ctx());
  expect(p).toContain("add a /health endpoint");
  expect(p).toContain("grove/t");
  expect(p.toLowerCase()).toContain("autonomous");
  expect(p.toLowerCase()).toContain("superpowers");
  expect(p.toLowerCase()).toMatch(/commit/);
});

test("autonomy append tells the agent not to wait for input", () => {
  expect(AUTONOMY_APPEND.toLowerCase()).toContain("autonomous");
  expect(AUTONOMY_APPEND.toLowerCase()).toMatch(/never wait|no human|do not wait/);
});
