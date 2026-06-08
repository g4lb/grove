import { test, expect } from "bun:test";
import { FakeAgentRunner, ok, fail } from "../../src/agent/fake-agent-runner.ts";
import type { AgentEvent, SessionContext } from "../../src/agent/events.ts";

const ctx: SessionContext = {
  taskId: "task_1",
  title: "x",
  prose: "do the thing",
  worktreePath: "/wt",
  branch: "grove/task_1",
  model: "m",
  superpowersPath: "/sp",
};

async function drain(gen: AsyncGenerator<AgentEvent, any>) {
  const seen: AgentEvent[] = [];
  let next = await gen.next();
  while (!next.done) {
    seen.push(next.value);
    next = await gen.next();
  }
  return { seen, result: next.value };
}

test("FakeAgentRunner yields scripted events and returns the scripted result", async () => {
  const events: AgentEvent[] = [
    { type: "notice", message: "start" },
    { type: "token", text: "hello" },
    { type: "tool_use", tool: "Write", input: { path: "hello.txt" } },
  ];
  const runner = new FakeAgentRunner(ok("designed", events));

  const { seen, result } = await drain(runner.run(ctx));
  expect(seen).toEqual(events);
  expect(result).toEqual({ success: true, summary: "designed", costUsd: 0, turns: 0, sessionId: "s" });
});

test("FakeAgentRunner records the contexts it received", async () => {
  const runner = new FakeAgentRunner(ok());
  await drain(runner.run(ctx));
  expect(runner.contexts).toEqual([ctx]);
});

test("fail() produces a failed session result", async () => {
  const runner = new FakeAgentRunner(fail("nope"));
  const { result } = await drain(runner.run(ctx));
  expect(result.success).toBe(false);
  expect(result.summary).toBe("nope");
});
