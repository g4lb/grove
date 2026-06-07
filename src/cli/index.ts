#!/usr/bin/env bun
import { runDoctor, checkClaudeRuntime } from "./doctor.ts";
import { BunCommandRunner } from "../infra/command-runner.ts";
import { runInit } from "./init.ts";
import { resolvePaths } from "../config/paths.ts";
import { join } from "node:path";
import { homedir } from "node:os";
import { chmodSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { CLAUDE_SDK_VERSION } from "../agent/sdk-version.ts";
import { installRuntime, detectLibc } from "../runtime/fetch-claude.ts";
import { runInstallRuntime } from "./install-runtime.ts";
import { SqliteStore } from "../store/sqlite-store.ts";
import { DockerRunner } from "../infra/docker-runner.ts";
import { GitRunner } from "../infra/git-runner.ts";
import { GitWorktreeManager } from "../infra/worktree-manager.ts";
import { DockerComposeManager } from "../infra/compose-manager.ts";
import { runGc, gcDeps, findOrphans } from "./gc.ts";
import { loadConfig } from "../config/config.ts";
import { InfraManager } from "../infra/infra-manager.ts";
import { ShellDiskMonitor } from "../infra/disk-monitor.ts";
import { SdkAgentRunner } from "../agent/sdk-agent-runner.ts";
import { resolveClaudePath } from "../agent/claude-binary.ts";
import { detectCredentials } from "../agent/credentials.ts";
import { HeuristicRouter } from "../engine/router.ts";
import { TaskEngine } from "../engine/task-engine.ts";
import { runTask } from "./run-driver.ts";
import { stdinGateDecider } from "./gate-prompt.ts";
import React from "react";
import { render } from "ink";
import { App } from "../app/app.tsx";
import { TaskRunController } from "../app/controller.ts";

const VERSION = "0.0.1";

function printUsage(): void {
  console.log('grove — usage: grove [run "<prose>" [--yes] | init | gc [--yes] | doctor | install-runtime | --version]');
}

function grovePaths() {
  const root = process.env.GROVE_HOME ?? join(homedir(), ".grove");
  return resolvePaths(root);
}

async function launchTui(): Promise<number> {
  const paths = grovePaths();
  mkdirSync(paths.tasksDir, { recursive: true });
  if (!detectCredentials(process.env).present) {
    console.log("no Anthropic credential — set ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN)");
    return 1;
  }
  const runtimeDir = join(paths.root, "runtime");
  const claudePath = resolveClaudePath({ env: process.env, runtimeDir });
  if (!claudePath) {
    console.log("claude runtime not installed — run `grove install-runtime`");
    return 1;
  }
  const runner = new BunCommandRunner();
  const repoPath = process.cwd();
  const config = await loadConfig(paths);
  const store = SqliteStore.open(paths.dbFile);
  const git = new GitRunner(runner, repoPath);
  const worktrees = new GitWorktreeManager(git, paths);
  const compose = new DockerComposeManager(new DockerRunner(runner));
  const infra = new InfraManager(worktrees, compose);
  const agent = new SdkAgentRunner({ env: process.env, claudePath });
  const engine = new TaskEngine({ store, agent, infra, model: config.agent.model });
  const controller = new TaskRunController(engine, new HeuristicRouter(), repoPath);
  controller.setLister(() => engine.listTasks());

  try {
    const { waitUntilExit } = render(React.createElement(App, { controller }));
    await waitUntilExit();
    return 0;
  } finally {
    store.close();
  }
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[2];
  switch (cmd) {
    case undefined:
      return launchTui();
    case "-v":
    case "--version":
      console.log(VERSION);
      return 0;
    case "doctor": {
      const paths = grovePaths();
      const runtimeDir = join(paths.root, "runtime");
      const markerPath = join(runtimeDir, "claude.version");
      const report = await runDoctor(new BunCommandRunner(), process.env, [
        () =>
          checkClaudeRuntime({
            resolve: () => resolveClaudePath({ env: process.env, runtimeDir }),
            installedVersion: () => (existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() : null),
            expected: CLAUDE_SDK_VERSION,
          }),
      ]);
      for (const c of report.checks) {
        console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
      }
      console.log(report.ok ? "\nAll good." : "\nMissing dependencies — see above.");
      return report.ok ? 0 : 1;
    }
    case "init": {
      const paths = grovePaths();
      const result = await runInit({
        runner: new BunCommandRunner(),
        paths,
        repoPath: process.cwd(),
      });
      console.log(`grove initialized at ${paths.root}`);
      console.log(`${result.isGitRepo ? "✓" : "✗"} current directory is a git repo`);
      for (const c of result.doctor.checks) {
        console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
      }
      console.log(result.ok ? "\nReady." : "\nSetup incomplete — see above.");
      return result.ok ? 0 : 1;
    }
    case "gc": {
      const yes = argv.includes("--yes");
      const paths = grovePaths();
      const runner = new BunCommandRunner();
      // Ensure the grove home exists so SqliteStore.open can create the db file
      // even before `grove init` has run.
      mkdirSync(paths.tasksDir, { recursive: true });
      const store = SqliteStore.open(paths.dbFile);
      try {
        const docker = new DockerRunner(runner);
        const git = new GitRunner(runner, process.cwd());
        const worktrees = new GitWorktreeManager(git, paths);
        const compose = new DockerComposeManager(docker);
        const deps = gcDeps(paths, store, docker, worktrees, compose);

        const candidates = await deps.discover();
        const orphans = findOrphans(candidates, { statusOf: deps.statusOf });

        if (orphans.length === 0) {
          console.log("grove gc: nothing to reclaim.");
          return 0;
        }
        console.log(`grove gc will reclaim ${orphans.length} orphaned task(s):`);
        for (const id of orphans) console.log(`  - ${id}`);
        if (!yes) {
          console.log("\nRe-run with --yes to reclaim them.");
          return 0;
        }
        const report = await runGc(deps);
        console.log(`\nReclaimed ${report.reclaimed.length}, kept ${report.kept.length}, errors ${report.errors.length}.`);
        for (const e of report.errors) console.log(`  ! ${e.taskId}: ${e.message}`);
        return report.errors.length === 0 ? 0 : 1;
      } finally {
        store.close();
      }
    }
    case "run": {
      const yes = argv.includes("--yes");
      const prose = argv.slice(3).filter((a) => !a.startsWith("--")).join(" ").trim();
      if (prose.length === 0) {
        console.log('grove — usage: grove run "<what you want to do>" [--yes]');
        return 0;
      }

      const paths = grovePaths();
      mkdirSync(paths.tasksDir, { recursive: true });
      const runner = new BunCommandRunner();
      const repoPath = process.cwd();
      const store = SqliteStore.open(paths.dbFile);
      try {
        const config = await loadConfig(paths);
        const git = new GitRunner(runner, repoPath);
        const worktrees = new GitWorktreeManager(git, paths);
        const compose = new DockerComposeManager(new DockerRunner(runner));
        const infra = new InfraManager(worktrees, compose);
        const runtimeDir = join(paths.root, "runtime");
        const claudePath = resolveClaudePath({ env: process.env, runtimeDir });
        const agent = new SdkAgentRunner({ env: process.env, claudePath });
        const engine = new TaskEngine({ store, agent, infra, model: config.agent.model });

        const result = await runTask(prose, {
          engine,
          router: new HeuristicRouter(),
          disk: new ShellDiskMonitor(runner),
          thresholds: config.disk,
          paths,
          repoPath,
          hasCredential: detectCredentials(process.env).present,
          hasClaudeRuntime: claudePath !== null,
          isGitRepo: await git.isGitRepo(),
          yes,
          decide: () => stdinGateDecider(async (p) => prompt(p) ?? ""),
          out: (line) => console.log(line),
        });

        console.log(`\n${result.message}`);
        return result.ok ? 0 : 1;
      } finally {
        store.close();
      }
    }
    case "install-runtime": {
      const paths = grovePaths();
      const runtimeDir = join(paths.root, "runtime");
      mkdirSync(runtimeDir, { recursive: true });
      const markerPath = join(runtimeDir, "claude.version");
      const libc = process.platform === "linux" ? detectLibc() : undefined;
      return runInstallRuntime({
        platformName: process.platform,
        archName: process.arch,
        libc,
        version: CLAUDE_SDK_VERSION,
        runtimeDir,
        out: (line) => console.log(line),
        install: (platform) =>
          installRuntime({
            platform,
            version: CLAUDE_SDK_VERSION,
            runtimeDir,
            download: async (url) => {
              const res = await fetch(url);
              if (!res.ok) throw new Error(`registry returned ${res.status} for ${url}`);
              return res.arrayBuffer();
            },
            extractClaude: async (tgz, destDir) => {
              const tmp = join(destDir, "claude.tgz");
              writeFileSync(tmp, new Uint8Array(tgz));
              const proc = Bun.spawn(["tar", "-xzf", tmp, "-C", destDir, "--strip-components=1", "package/claude"], {
                stdout: "pipe",
                stderr: "pipe",
              });
              if ((await proc.exited) !== 0) throw new Error("failed to extract claude from the tarball");
              try { unlinkSync(tmp); } catch {}
              return join(destDir, "claude");
            },
            ensureExecutable: (p) => chmodSync(p, 0o755),
            readMarker: () => (existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() : null),
            writeMarker: (v) => writeFileSync(markerPath, v),
            exists: () => existsSync(join(runtimeDir, "claude")),
          }),
      });
    }
    default:
      printUsage();
      return 0;
  }
}

main(process.argv).then((code) => process.exit(code));
