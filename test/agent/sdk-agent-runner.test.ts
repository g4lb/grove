import { test, expect } from "bun:test";
import { SdkAgentRunner, type QueryFn } from "../../src/agent/sdk-agent-runner.ts";
import type { AgentEvent, SessionContext } from "../../src/agent/events.ts";

function fakeQuery(messages: unknown[]): QueryFn {
  return ((_args: unknown) => {
    async function* gen() {
      for (const m of messages) yield m;
    }
    return gen();
  }) as unknown as QueryFn;
}

function ctx(over: Partial<SessionContext> = {}): SessionContext {
  return {
    taskId: "task_1",
    title: "Add login",
    prose: "Add login",
    worktreePath: "/wt",
    branch: "grove/task_1",
    model: "claude-opus-4-8",
    superpowersPath: "/sp",
    ...over,
  };
}

async function drain(gen: AsyncGenerator<AgentEvent, any>) {
  const seen: AgentEvent[] = [];
  let next = await gen.next();
  while (!next.done) {
    seen.push(next.value);
    next = await gen.next();
  }
  return { seen, result: next.value };
}

test("maps stream tokens and tool_use blocks to AgentEvents and returns a success result", async () => {
  const runner = new SdkAgentRunner({
    queryFn: fakeQuery([
      { type: "system", subtype: "init", session_id: "sess-1" },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } } },
      { type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Write", input: { path: "hello.txt" } } } },
      { type: "result", subtype: "success", result: "all done", total_cost_usd: 0.02 },
    ]),
    env: { ANTHROPIC_API_KEY: "sk-test" },
  });

  const { seen, result } = await drain(runner.run(ctx()));
  expect(seen).toContainEqual({ type: "notice", message: "session started" });
  expect(seen).toContainEqual({ type: "token", text: "Hello" });
  expect(seen).toContainEqual({ type: "tool_use", tool: "Write", input: { path: "hello.txt" } });
  expect(result.success).toBe(true);
  expect(result.summary).toBe("all done");
  expect(result.costUsd).toBe(0.02);
  expect(result.sessionId).toBe("sess-1");
});

test("returns success:false when the result subtype is an error", async () => {
  const runner = new SdkAgentRunner({
    queryFn: fakeQuery([
      { type: "system", subtype: "init", session_id: "s" },
      { type: "result", subtype: "error_max_turns", total_cost_usd: 0.01 },
    ]),
    env: { ANTHROPIC_API_KEY: "sk-test" },
  });
  const { result } = await drain(runner.run(ctx()));
  expect(result.success).toBe(false);
  expect(result.summary).toBe("error_max_turns");
  expect(result.costUsd).toBe(0.01);
});

test("a thrown query()/stream error returns a failed SessionResult instead of propagating", async () => {
  const throwingQuery = (() => {
    async function* gen() {
      yield { type: "system", subtype: "init", session_id: "s" };
      throw new Error("network drop");
    }
    return gen();
  }) as unknown as QueryFn;
  const runner = new SdkAgentRunner({ queryFn: throwingQuery, env: { ANTHROPIC_API_KEY: "sk-test" } });
  const { result } = await drain(runner.run(ctx()));
  expect(result.success).toBe(false);
  expect(result.summary).toContain("network drop");
  expect(result.sessionId).toBe("s");
});

test("passes session options into query (plugin, cwd, model, bypassPermissions, append, env, prompt)", async () => {
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
  await drain(runner.run(ctx({ worktreePath: "/my/wt", superpowersPath: "/path/to/sp", prose: "Add login flow" })));

  expect(captured.options.plugins[0]).toEqual({ type: "local", path: "/path/to/sp" });
  expect(captured.options.cwd).toBe("/my/wt");
  expect(captured.options.model).toBe("claude-opus-4-8");
  expect(captured.options.permissionMode).toBe("bypassPermissions");
  expect(captured.options.systemPrompt.preset).toBe("claude_code");
  expect(captured.options.systemPrompt.append.length).toBeGreaterThan(0);
  expect(captured.options.maxTurns).toBe(200);
  expect(captured.options.env.ANTHROPIC_API_KEY).toBe("sk-test");
  expect(captured.options.env.FOO).toBe("bar");
  expect(captured.prompt).toContain("Add login flow");
});
