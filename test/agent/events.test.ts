import { test, expect } from "bun:test";
import type { AgentEvent, PhaseResult, PhaseContext } from "../../src/agent/events.ts";

test("AgentEvent union members are constructable", () => {
  const token: AgentEvent = { type: "token", text: "hi" };
  const toolUse: AgentEvent = { type: "tool_use", tool: "Write", input: { path: "a" } };
  const notice: AgentEvent = { type: "notice", message: "starting" };
  expect(token.type).toBe("token");
  expect(toolUse.tool).toBe("Write");
  expect(notice.message).toBe("starting");
});

test("PhaseResult and PhaseContext shapes hold", () => {
  const result: PhaseResult = {
    success: true,
    summary: "done",
    artifactPath: "/wt/.grove/design.md",
    costUsd: 0.01,
    sessionId: "s1",
  };
  const ctx: PhaseContext = {
    taskId: "task_1",
    title: "Add login",
    description: "OAuth",
    worktreePath: "/wt",
    model: "claude-opus-4-8",
    priorArtifacts: [{ phase: "brainstorm", path: "/wt/.grove/design.md" }],
  };
  expect(result.success).toBe(true);
  expect(ctx.priorArtifacts[0]!.phase).toBe("brainstorm");
});
