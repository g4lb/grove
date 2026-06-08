import { test, expect } from "bun:test";
import type { AgentEvent, SessionResult, SessionContext } from "../../src/agent/events.ts";

test("AgentEvent union members are constructable", () => {
  const token: AgentEvent = { type: "token", text: "hi" };
  const toolUse: AgentEvent = { type: "tool_use", tool: "Write", input: { path: "a" } };
  const notice: AgentEvent = { type: "notice", message: "starting" };
  expect(token.type).toBe("token");
  expect(toolUse.tool).toBe("Write");
  expect(notice.message).toBe("starting");
});

test("SessionResult and SessionContext shapes hold", () => {
  const result: SessionResult = {
    success: true,
    summary: "done",
    costUsd: 0.01,
    turns: 3,
    sessionId: "s1",
  };
  const ctx: SessionContext = {
    taskId: "task_1",
    title: "Add login",
    prose: "Add login with OAuth",
    worktreePath: "/wt",
    branch: "grove/task_1",
    model: "claude-opus-4-8",
    superpowersPath: "/sp",
  };
  expect(result.success).toBe(true);
  expect(ctx.branch).toBe("grove/task_1");
});
