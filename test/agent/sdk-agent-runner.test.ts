import { test, expect } from "bun:test";
import { SdkAgentRunner, type QueryFn } from "../../src/agent/sdk-agent-runner.ts";
import type { AgentEvent, PhaseContext } from "../../src/agent/events.ts";

const ctx: PhaseContext = {
  taskId: "task_1",
  title: "Add login",
  worktreePath: "/wt",
  model: "claude-opus-4-8",
  priorArtifacts: [],
};

// A fake query() that yields a realistic SDKMessage sequence.
function fakeQuery(messages: unknown[]): QueryFn {
  return ((_args: unknown) => {
    async function* gen() {
      for (const m of messages) yield m;
    }
    return gen();
  }) as unknown as QueryFn;
}

test("maps stream tokens and tool_use blocks to AgentEvents and returns a success result", async () => {
  const runner = new SdkAgentRunner({
    queryFn: fakeQuery([
      { type: "system", subtype: "init", session_id: "sess-1" },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { path: ".grove/design.md" } }] } },
      { type: "result", subtype: "success", result: "design complete", total_cost_usd: 0.02 },
    ]),
    env: { ANTHROPIC_API_KEY: "sk-test" },
  });

  const seen: AgentEvent[] = [];
  const gen = runner.run("brainstorm", ctx);
  let next = await gen.next();
  while (!next.done) {
    seen.push(next.value);
    next = await gen.next();
  }

  expect(seen).toContainEqual({ type: "token", text: "Hello" });
  expect(seen).toContainEqual({ type: "tool_use", tool: "Write", input: { path: ".grove/design.md" } });
  const result = next.value;
  expect(result.success).toBe(true);
  expect(result.summary).toBe("design complete");
  expect(result.costUsd).toBe(0.02);
  expect(result.sessionId).toBe("sess-1");
  expect(result.artifactPath).toBe("/wt/.grove/design.md");
});

test("returns success:false when the result subtype is an error", async () => {
  const runner = new SdkAgentRunner({
    queryFn: fakeQuery([
      { type: "system", subtype: "init", session_id: "s" },
      { type: "result", subtype: "error_max_turns", result: "", total_cost_usd: 0.01 },
    ]),
    env: { ANTHROPIC_API_KEY: "sk-test" },
  });
  const gen = runner.run("execute", ctx);
  let next = await gen.next();
  while (!next.done) next = await gen.next();
  expect(next.value.success).toBe(false);
  expect(next.value.summary).toContain("error_max_turns");
  expect(next.value.artifactPath).toBeNull();
});

test("passes phase options into query (cwd, model, bypassPermissions, append, env)", async () => {
  let captured: any;
  const queryFn = ((args: any) => {
    captured = args;
    async function* gen() {
      yield { type: "system", subtype: "init", session_id: "s" };
      yield { type: "result", subtype: "success", result: "ok", total_cost_usd: 0 };
    }
    return gen();
  }) as unknown as QueryFn;

  const runner = new SdkAgentRunner({ queryFn, env: { ANTHROPIC_API_KEY: "sk-test", FOO: "bar" } });
  const gen = runner.run("plan", ctx);
  while (!(await gen.next()).done) { /* drain */ }

  expect(captured.options.cwd).toBe("/wt");
  expect(captured.options.model).toBe("claude-opus-4-8");
  expect(captured.options.permissionMode).toBe("bypassPermissions");
  expect(captured.options.systemPrompt.preset).toBe("claude_code");
  expect(captured.options.systemPrompt.append.length).toBeGreaterThan(0);
  expect(captured.options.maxTurns).toBeGreaterThan(0);
  // The full base env passes through so the SDK subprocess can launch (PATH, etc.),
  // AND the credential is guaranteed present.
  expect(captured.options.env.ANTHROPIC_API_KEY).toBe("sk-test");
  expect(captured.options.env.FOO).toBe("bar");
  // the prompt carries the task title
  expect(captured.prompt).toContain("Add login");
});
