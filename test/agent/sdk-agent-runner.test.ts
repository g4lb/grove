import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SdkAgentRunner, type QueryFn } from "../../src/agent/sdk-agent-runner.ts";
import type { AgentEvent, PhaseContext } from "../../src/agent/events.ts";

function fakeQuery(messages: unknown[]): QueryFn {
  return ((_args: unknown) => {
    async function* gen() {
      for (const m of messages) yield m;
    }
    return gen();
  }) as unknown as QueryFn;
}

let wt: string;
beforeEach(() => {
  wt = mkdtempSync(join(tmpdir(), "grove-sdk-"));
});
afterEach(() => {
  rmSync(wt, { recursive: true, force: true });
});

function ctxFor(worktreePath: string): PhaseContext {
  return { taskId: "task_1", title: "Add login", worktreePath, model: "claude-opus-4-8", priorArtifacts: [] };
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
  // brainstorm declares .grove/design.md as its gate artifact — create it so the
  // existence check passes and success is a real guarantee.
  mkdirSync(join(wt, ".grove"), { recursive: true });
  writeFileSync(join(wt, ".grove", "design.md"), "# design\n");

  const runner = new SdkAgentRunner({
    queryFn: fakeQuery([
      { type: "system", subtype: "init", session_id: "sess-1" },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { path: ".grove/design.md" } }] } },
      { type: "result", subtype: "success", result: "design complete", total_cost_usd: 0.02 },
    ]),
    env: { ANTHROPIC_API_KEY: "sk-test" },
  });

  const { seen, result } = await drain(runner.run("brainstorm", ctxFor(wt)));
  expect(seen).toContainEqual({ type: "token", text: "Hello" });
  expect(seen).toContainEqual({ type: "tool_use", tool: "Write", input: { path: ".grove/design.md" } });
  expect(result.success).toBe(true);
  expect(result.summary).toBe("design complete");
  expect(result.costUsd).toBe(0.02);
  expect(result.sessionId).toBe("sess-1");
  expect(result.artifactPath).toBe(join(wt, ".grove/design.md"));
});

test("downgrades to success:false when the SDK reports success but the gate artifact was not written", async () => {
  // No file created in wt/.grove — the artifact is missing.
  const runner = new SdkAgentRunner({
    queryFn: fakeQuery([
      { type: "system", subtype: "init", session_id: "s" },
      { type: "result", subtype: "success", result: "claims done", total_cost_usd: 0 },
    ]),
    env: { ANTHROPIC_API_KEY: "sk-test" },
  });
  const { result } = await drain(runner.run("brainstorm", ctxFor(wt)));
  expect(result.success).toBe(false);
  expect(result.summary).toContain("did not produce");
  expect(result.artifactPath).toBe(join(wt, ".grove/design.md"));
});

test("returns success:false when the result subtype is an error", async () => {
  const runner = new SdkAgentRunner({
    queryFn: fakeQuery([
      { type: "system", subtype: "init", session_id: "s" },
      { type: "result", subtype: "error_max_turns", result: "", total_cost_usd: 0.01 },
    ]),
    env: { ANTHROPIC_API_KEY: "sk-test" },
  });
  const { result } = await drain(runner.run("execute", ctxFor(wt)));
  expect(result.success).toBe(false);
  expect(result.summary).toContain("error_max_turns");
  expect(result.artifactPath).toBeNull(); // execute has no artifact
});

test("a thrown query()/stream error returns a failed PhaseResult instead of propagating", async () => {
  const throwingQuery = (() => {
    async function* gen() {
      yield { type: "system", subtype: "init", session_id: "s" };
      throw new Error("network drop");
    }
    return gen();
  }) as unknown as QueryFn;
  const runner = new SdkAgentRunner({ queryFn: throwingQuery, env: { ANTHROPIC_API_KEY: "sk-test" } });
  const { result } = await drain(runner.run("execute", ctxFor(wt)));
  expect(result.success).toBe(false);
  expect(result.summary).toContain("network drop");
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
  await drain(runner.run("plan", ctxFor(wt)));

  expect(captured.options.cwd).toBe(wt);
  expect(captured.options.model).toBe("claude-opus-4-8");
  expect(captured.options.permissionMode).toBe("bypassPermissions");
  expect(captured.options.systemPrompt.preset).toBe("claude_code");
  expect(captured.options.systemPrompt.append.length).toBeGreaterThan(0);
  expect(captured.options.maxTurns).toBeGreaterThan(0);
  expect(captured.options.env.ANTHROPIC_API_KEY).toBe("sk-test");
  expect(captured.options.env.FOO).toBe("bar");
  expect(captured.prompt).toContain("Add login");
});
