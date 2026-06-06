import { test, expect } from "bun:test";
import { runDoctor } from "../../src/cli/doctor.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class FakeRunner implements CommandRunner {
  constructor(private map: Record<string, CommandResult>) {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    const key = [cmd, ...args].join(" ");
    return this.map[key] ?? { code: 127, stdout: "", stderr: "not found" };
  }
}

const OK = (stdout: string): CommandResult => ({ code: 0, stdout, stderr: "" });

test("runDoctor reports ok when all dependencies are present", async () => {
  const runner = new FakeRunner({
    "git --version": OK("git version 2.45.0"),
    "docker --version": OK("Docker version 27.0.0"),
    "docker compose version": OK("Docker Compose version v2.29.0"),
  });
  const report = await runDoctor(runner, { ANTHROPIC_API_KEY: "sk-test" });
  expect(report.ok).toBe(true);
  expect(report.checks.length).toBe(4);
  expect(report.checks.every((c) => c.ok)).toBe(true);
  const git = report.checks.find((c) => c.name === "git")!;
  expect(git.detail).toBe("git version 2.45.0");
});

test("runDoctor reports not-ok when docker is missing", async () => {
  const runner = new FakeRunner({
    "git --version": OK("git version 2.45.0"),
    // docker + compose missing -> default 127
  });
  const report = await runDoctor(runner);
  expect(report.ok).toBe(false);
  const docker = report.checks.find((c) => c.name === "docker")!;
  expect(docker.ok).toBe(false);
});
