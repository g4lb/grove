import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerComposeManager, composeProjectFor } from "../../src/infra/compose-manager.ts";
import { DockerRunner } from "../../src/infra/docker-runner.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class ScriptedRunner implements CommandRunner {
  calls: string[][] = [];
  constructor(private result: CommandResult = { code: 0, stdout: "", stderr: "" }) {}
  async run(_cmd: string, args: string[]): Promise<CommandResult> {
    this.calls.push(args);
    return this.result;
  }
}

function worktreeWithCompose(): string {
  const dir = mkdtempSync(join(tmpdir(), "grove-wt-"));
  writeFileSync(join(dir, "docker-compose.yml"), "services:\n  web:\n    image: nginx\n");
  return dir;
}

test("composeProjectFor builds grove-<taskId>", () => {
  expect(composeProjectFor("task_abc123")).toBe("grove-task_abc123");
});

test("up() runs docker compose up -d with the project and compose file; returns true", async () => {
  const wt = worktreeWithCompose();
  try {
    const runner = new ScriptedRunner();
    const mgr = new DockerComposeManager(new DockerRunner(runner));
    const started = await mgr.up("task_abc123", wt);
    expect(started).toBe(true);
    const call = runner.calls[0]!;
    expect(call.slice(0, 5)).toEqual(["compose", "-p", "grove-task_abc123", "-f", join(wt, "docker-compose.yml")]);
    expect(call).toContain("up");
    expect(call).toContain("-d");
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test("up() is a no-op returning false when the worktree has no compose file", async () => {
  const wt = mkdtempSync(join(tmpdir(), "grove-wt-"));
  try {
    const runner = new ScriptedRunner();
    const mgr = new DockerComposeManager(new DockerRunner(runner));
    const started = await mgr.up("task_abc123", wt);
    expect(started).toBe(false);
    expect(runner.calls.length).toBe(0);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test("down() runs compose down --volumes --remove-orphans; returns true", async () => {
  const wt = worktreeWithCompose();
  try {
    const runner = new ScriptedRunner();
    const mgr = new DockerComposeManager(new DockerRunner(runner));
    const stopped = await mgr.down("task_abc123", wt);
    expect(stopped).toBe(true);
    const call = runner.calls[0]!;
    expect(call.slice(0, 3)).toEqual(["compose", "-p", "grove-task_abc123"]);
    expect(call).toContain("down");
    expect(call).toContain("--volumes");
    expect(call).toContain("--remove-orphans");
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});

test("down() is a no-op returning false when the worktree has no compose file", async () => {
  const wt = mkdtempSync(join(tmpdir(), "grove-wt-"));
  try {
    const runner = new ScriptedRunner();
    const mgr = new DockerComposeManager(new DockerRunner(runner));
    expect(await mgr.down("task_abc123", wt)).toBe(false);
    expect(runner.calls.length).toBe(0);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
});
