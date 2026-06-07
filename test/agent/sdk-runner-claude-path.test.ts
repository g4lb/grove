import { test, expect } from "bun:test";
import { SdkAgentRunner } from "../../src/agent/sdk-agent-runner.ts";
import type { SessionContext } from "../../src/agent/events.ts";

function ctx(): SessionContext {
  return { taskId: "t", title: "x", prose: "x", worktreePath: "/wt", branch: "grove/t", model: "m", superpowersPath: "/sp" };
}

function fakeQuery(captured: { opts?: any }) {
  return ((arg: any) => {
    captured.opts = arg.options;
    return (async function* () {})();
  }) as any;
}

async function drain(runner: SdkAgentRunner) {
  const gen = runner.run(ctx());
  let r = await gen.next();
  while (!r.done) r = await gen.next();
}

test("passes pathToClaudeCodeExecutable when a claude path is set", async () => {
  const captured: { opts?: any } = {};
  const runner = new SdkAgentRunner({ queryFn: fakeQuery(captured), env: {}, claudePath: "/home/.grove/runtime/claude" });
  await drain(runner);
  expect(captured.opts.pathToClaudeCodeExecutable).toBe("/home/.grove/runtime/claude");
});

test("omits pathToClaudeCodeExecutable when no claude path (dev: SDK self-resolves)", async () => {
  const captured: { opts?: any } = {};
  const runner = new SdkAgentRunner({ queryFn: fakeQuery(captured), env: {}, claudePath: null });
  await drain(runner);
  expect("pathToClaudeCodeExecutable" in captured.opts).toBe(false);
});
