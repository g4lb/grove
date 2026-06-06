import { test, expect } from "bun:test";
import { FakeAgentRunner } from "../../src/agent/fake-agent-runner.ts";
import type { AgentEvent, PhaseContext, PhaseResult } from "../../src/agent/events.ts";

const ctx: PhaseContext = {
  taskId: "task_1",
  title: "x",
  worktreePath: "/wt",
  model: "m",
  priorArtifacts: [],
};

test("FakeAgentRunner yields scripted events and returns the scripted result", async () => {
  const events: AgentEvent[] = [
    { type: "notice", message: "start" },
    { type: "token", text: "hello" },
    { type: "tool_use", tool: "Write", input: { path: ".grove/design.md" } },
  ];
  const result: PhaseResult = {
    success: true,
    summary: "designed",
    artifactPath: "/wt/.grove/design.md",
    costUsd: 0,
    sessionId: "s1",
  };
  const runner = new FakeAgentRunner({ brainstorm: { events, result } });

  const seen: AgentEvent[] = [];
  const gen = runner.run("brainstorm", ctx);
  let next = await gen.next();
  while (!next.done) {
    seen.push(next.value);
    next = await gen.next();
  }
  expect(seen).toEqual(events);
  expect(next.value).toEqual(result);
});

test("FakeAgentRunner records the calls it received", async () => {
  const runner = new FakeAgentRunner({
    plan: { events: [], result: { success: true, summary: "", artifactPath: null, costUsd: 0, sessionId: null } },
  });
  const gen = runner.run("plan", ctx);
  while (!(await gen.next()).done) { /* drain */ }
  expect(runner.calls).toEqual([{ phase: "plan", taskId: "task_1" }]);
});

test("FakeAgentRunner throws for an unscripted phase", async () => {
  const runner = new FakeAgentRunner({});
  const gen = runner.run("execute", ctx);
  await expect(gen.next()).rejects.toThrow("no script for phase: execute");
});
