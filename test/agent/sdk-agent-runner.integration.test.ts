import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SdkAgentRunner } from "../../src/agent/sdk-agent-runner.ts";
import { hasCredentials } from "../../src/agent/credentials.ts";
import type { PhaseContext } from "../../src/agent/events.ts";

const ENABLED = process.env.GROVE_AGENT_TESTS === "1" && hasCredentials(process.env);
const maybe = ENABLED ? test : test.skip;

let wt: string;
beforeEach(() => {
  wt = mkdtempSync(join(tmpdir(), "grove-agentit-"));
});
afterEach(() => {
  rmSync(wt, { recursive: true, force: true });
});

maybe("runs a real brainstorm phase end-to-end and produces a result", async () => {
  const runner = new SdkAgentRunner(); // real query(), real credentials from process.env
  const ctx: PhaseContext = {
    taskId: "task_smoke1",
    title: "Add a function that returns the string 'hello'",
    description: "Keep it trivial; this is a smoke test.",
    worktreePath: wt,
    model: process.env.GROVE_AGENT_MODEL ?? "claude-opus-4-8",
    priorArtifacts: [],
  };

  let sawAnyEvent = false;
  const gen = runner.run("brainstorm", ctx);
  let next = await gen.next();
  while (!next.done) {
    sawAnyEvent = true;
    next = await gen.next();
  }
  const result = next.value;
  expect(sawAnyEvent).toBe(true);
  expect(typeof result.summary).toBe("string");
  expect(result.success).toBe(true);
}, 180000);
