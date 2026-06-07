import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SdkAgentRunner } from "../../src/agent/sdk-agent-runner.ts";
import { hasCredentials } from "../../src/agent/credentials.ts";
import { resolveSuperpowers } from "../../src/agent/superpowers.ts";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { SessionContext } from "../../src/agent/events.ts";

const ENABLED = process.env.GROVE_AGENT_TESTS === "1" && hasCredentials(process.env);
const maybe = ENABLED ? test : test.skip;

let wt: string;
beforeEach(() => {
  wt = mkdtempSync(join(tmpdir(), "grove-agentit-"));
});
afterEach(() => {
  rmSync(wt, { recursive: true, force: true });
});

maybe("runs a real autonomous session end-to-end and produces a result", async () => {
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const superpowersPath = await resolveSuperpowers({
    env: process.env,
    grovePluginsDir: join(homedir(), ".grove", "plugins"),
    installedPluginsJsonPath: join(claudeConfigDir, "plugins", "installed_plugins.json"),
    fileExists: existsSync,
    readText: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
    gitClone: async (url, dest) => {
      const proc = Bun.spawn(["git", "clone", "--depth", "1", url, dest], { stdout: "pipe", stderr: "pipe" });
      if ((await proc.exited) !== 0) throw new Error("git clone failed");
    },
    rmDir: async (p) => rmSync(p, { recursive: true, force: true }),
    out: () => {},
  });

  const runner = new SdkAgentRunner(); // real query(), real credentials from process.env
  const ctx: SessionContext = {
    taskId: "task_smoke1",
    title: "Add a function that returns the string 'hello'",
    prose: "Add a function that returns the string 'hello'. Keep it trivial; this is a smoke test.",
    worktreePath: wt,
    branch: "grove/task_smoke1",
    model: process.env.GROVE_AGENT_MODEL ?? "claude-opus-4-8",
    superpowersPath,
  };

  let sawAnyEvent = false;
  const gen = runner.run(ctx);
  let next = await gen.next();
  while (!next.done) {
    sawAnyEvent = true;
    next = await gen.next();
  }
  const result = next.value;
  expect(sawAnyEvent).toBe(true);
  expect(typeof result.summary).toBe("string");
}, 300000);
