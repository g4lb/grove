import { test, expect } from "bun:test";
import { runDoctor } from "../../src/cli/doctor.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class MapRunner implements CommandRunner {
  constructor(private fn: (cmd: string, args: string[]) => CommandResult) {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    return this.fn(cmd, args);
  }
}
const OK = (s = ""): CommandResult => ({ code: 0, stdout: s, stderr: "" });
const allTools = new MapRunner((cmd, args) => {
  if (cmd === "git") return OK("git version 2.45.0");
  if (cmd === "docker" && args.includes("compose")) return OK("v2.29.0");
  if (cmd === "docker") return OK("Docker version 27.0.0");
  return { code: 127, stdout: "", stderr: "not found" };
});

test("doctor passes the credential check when ANTHROPIC_API_KEY is set", async () => {
  const report = await runDoctor(allTools, { ANTHROPIC_API_KEY: "sk-1" });
  const cred = report.checks.find((c) => c.name === "anthropic credential")!;
  expect(cred.ok).toBe(true);
  expect(report.ok).toBe(true);
});

test("doctor fails the credential check when no credential is set", async () => {
  // Inject login probes that return false so the real keychain (which is logged
  // into Claude Code on dev machines) doesn't make this non-deterministic.
  const report = await runDoctor(allTools, {}, [], { fileExists: () => false, keychainHasLogin: () => false });
  const cred = report.checks.find((c) => c.name === "anthropic credential")!;
  expect(cred.ok).toBe(false);
  expect(report.ok).toBe(false);
  expect(cred.detail).toContain("claude login");
});

test("doctor passes the credential check when logged into Claude Code", async () => {
  const report = await runDoctor(allTools, {}, [], { fileExists: () => false, keychainHasLogin: () => true });
  const cred = report.checks.find((c) => c.name === "anthropic credential")!;
  expect(cred.ok).toBe(true);
  expect(cred.detail).toContain("claude_code_login");
});

test("runDoctor still works without an env argument (defaults to process.env)", async () => {
  const report = await runDoctor(allTools);
  expect(report.checks.some((c) => c.name === "anthropic credential")).toBe(true);
});
