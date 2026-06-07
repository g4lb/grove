import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { runTask } from "../../src/cli/run-driver.ts";
import { TaskEngine } from "../../src/engine/task-engine.ts";
import { SqliteStore } from "../../src/store/sqlite-store.ts";
import { BunCommandRunner } from "../../src/infra/command-runner.ts";
import { GitRunner } from "../../src/infra/git-runner.ts";
import { GitWorktreeManager } from "../../src/infra/worktree-manager.ts";
import { DockerRunner } from "../../src/infra/docker-runner.ts";
import { DockerComposeManager } from "../../src/infra/compose-manager.ts";
import { InfraManager } from "../../src/infra/infra-manager.ts";
import { ShellDiskMonitor } from "../../src/infra/disk-monitor.ts";
import { SdkAgentRunner } from "../../src/agent/sdk-agent-runner.ts";
import { resolveClaudePath } from "../../src/agent/claude-binary.ts";
import { resolveSuperpowers } from "../../src/agent/superpowers.ts";
import { hasCredentials } from "../../src/agent/credentials.ts";
import { resolvePaths } from "../../src/config/paths.ts";

const ENABLED = process.env.GROVE_E2E === "1" && hasCredentials(process.env);
const maybe = ENABLED ? test : test.skip;

let repo: string;
let groveRoot: string;
async function sh(cmd: string, args: string[], cwd: string) {
  await Bun.spawn([cmd, ...args], { cwd, stdout: "pipe", stderr: "pipe" }).exited;
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "grove-e2e-repo-"));
  groveRoot = mkdtempSync(join(tmpdir(), "grove-e2e-home-"));
  await sh("git", ["init", "-q", "-b", "main"], repo);
  await sh("git", ["config", "user.email", "t@t.test"], repo);
  await sh("git", ["config", "user.name", "t"], repo);
  writeFileSync(join(repo, "README.md"), "# test\n");
  await sh("git", ["add", "."], repo);
  await sh("git", ["commit", "-q", "-m", "init"], repo);
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(groveRoot, { recursive: true, force: true });
});

maybe("runs a trivial task as one autonomous session -> done/blocked against the real agent", async () => {
  const paths = resolvePaths(groveRoot);
  const runner = new BunCommandRunner();
  const git = new GitRunner(runner, repo);
  const store = SqliteStore.open(paths.dbFile);
  const infra = new InfraManager(new GitWorktreeManager(git, paths), new DockerComposeManager(new DockerRunner(runner)));
  const claudePath = resolveClaudePath({ env: process.env, runtimeDir: join(paths.root, "runtime") });
  const engine = new TaskEngine({ store, agent: new SdkAgentRunner({ env: process.env, claudePath }), infra, model: process.env.GROVE_AGENT_MODEL ?? "claude-opus-4-8" });

  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const superpowersPath = await resolveSuperpowers({
    env: process.env,
    grovePluginsDir: join(paths.root, "plugins"),
    installedPluginsJsonPath: join(claudeConfigDir, "plugins", "installed_plugins.json"),
    fileExists: existsSync,
    readText: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
    gitClone: async (url, dest) => {
      const proc = Bun.spawn(["git", "clone", "--depth", "1", url, dest], { stdout: "pipe", stderr: "pipe" });
      if ((await proc.exited) !== 0) throw new Error("git clone failed");
    },
    out: () => {},
  });

  const result = await runTask("add a file hello.txt containing the word hello", {
    engine,
    disk: new ShellDiskMonitor(runner),
    thresholds: { warnBytes: 0, blockBytes: 0 },
    paths,
    repoPath: repo,
    hasCredential: true,
    hasClaudeRuntime: claudePath !== null,
    isGitRepo: true,
    superpowersPath,
    out: () => {},
  });

  // A trivial task should complete; if the agent blocks, that's still a non-throwing terminal state.
  expect(result.status === "done" || result.status === "blocked").toBe(true);

  // On done, the worktree branch should carry a commit.
  if (result.status === "done") {
    const task = engine.getStatus(result.taskId!);
    expect(task?.branch).toBeTruthy();
  }
  store.close();
}, 600000);
