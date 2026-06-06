import { test, expect } from "bun:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/cli/init.ts";
import { resolvePaths } from "../../src/config/paths.ts";
import type { CommandRunner, CommandResult } from "../../src/infra/command-runner.ts";

class MapRunner implements CommandRunner {
  constructor(private fn: (cmd: string, args: string[]) => CommandResult) {}
  async run(cmd: string, args: string[]): Promise<CommandResult> {
    return this.fn(cmd, args);
  }
}

const OK = (stdout = ""): CommandResult => ({ code: 0, stdout, stderr: "" });

function allGreenRunner(): CommandRunner {
  return new MapRunner((cmd, args) => {
    if (cmd === "git" && args.includes("--is-inside-work-tree")) return OK("true");
    if (cmd === "git" && args.includes("--version")) return OK("git version 2.45.0");
    if (cmd === "docker" && args.includes("compose")) return OK("Docker Compose version v2.29.0");
    if (cmd === "docker") return OK("Docker version 27.0.0");
    return { code: 127, stdout: "", stderr: "not found" };
  });
}

test("runInit creates grove dirs, db, and config; reports ok", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  const paths = resolvePaths(root);
  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-test";
  try {
    const result = await runInit({ runner: allGreenRunner(), paths, repoPath: "/repo" });
    expect(result.ok).toBe(true);
    expect(result.isGitRepo).toBe(true);
    expect(existsSync(paths.tasksDir)).toBe(true);
    expect(existsSync(paths.dbFile)).toBe(true);
    expect(existsSync(paths.configFile)).toBe(true);
    expect(result.doctor.ok).toBe(true);
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    rmSync(root, { recursive: true, force: true });
  }
});

test("runInit reports not-a-git-repo and ok=false when cwd is not a repo", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  const paths = resolvePaths(root);
  const runner = new MapRunner((cmd, args) => {
    if (cmd === "git" && args.includes("--is-inside-work-tree")) return { code: 128, stdout: "", stderr: "fatal" };
    if (cmd === "git" && args.includes("--version")) return OK("git version 2.45.0");
    if (cmd === "docker" && args.includes("compose")) return OK("v2.29.0");
    if (cmd === "docker") return OK("Docker version 27.0.0");
    return { code: 127, stdout: "", stderr: "not found" };
  });
  try {
    const result = await runInit({ runner, paths, repoPath: "/repo" });
    expect(result.isGitRepo).toBe(false);
    expect(result.ok).toBe(false);
    expect(existsSync(paths.dbFile)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runInit is idempotent (second run does not throw or clobber config)", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "grove-")), ".grove");
  const paths = resolvePaths(root);
  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-test";
  try {
    await runInit({ runner: allGreenRunner(), paths, repoPath: "/repo" });
    const second = await runInit({ runner: allGreenRunner(), paths, repoPath: "/repo" });
    expect(second.ok).toBe(true);
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    rmSync(root, { recursive: true, force: true });
  }
});
