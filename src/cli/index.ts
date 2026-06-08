#!/usr/bin/env bun
import { runDoctor, checkClaudeRuntime } from "./doctor.ts";
import { BunCommandRunner } from "../infra/command-runner.ts";
import { runInit } from "./init.ts";
import { resolvePaths } from "../config/paths.ts";
import { join } from "node:path";
import { homedir } from "node:os";
import { chmodSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { CLAUDE_SDK_VERSION } from "../agent/sdk-version.ts";
import { installRuntime, detectLibc, platformPackage } from "../runtime/fetch-claude.ts";
import { runInstallRuntime } from "./install-runtime.ts";
import { downloadWithProgress } from "../runtime/download.ts";
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
import { detectUsableCredential } from "../agent/credentials.ts";
import { resolveSuperpowers, SUPERPOWERS_REF } from "../agent/superpowers.ts";
import { TaskEngine } from "../engine/task-engine.ts";
import { runTask } from "./run-driver.ts";
import type { GrovePaths } from "../config/paths.ts";
import React from "react";
import { render } from "ink";
import { App } from "../app/app.tsx";
import { TaskRunController } from "../app/controller.ts";

const VERSION = "0.2.0";

function printUsage(): void {
  console.log('grove — usage: grove [run "<prose>" | init | gc [--yes] [--include-blocked] | doctor | install-runtime | --version]');
}

function grovePaths() {
  const root = process.env.GROVE_HOME ?? join(homedir(), ".grove");
  return resolvePaths(root);
}

/** Resolve (or one-time fetch) the obra/superpowers plugin, wired to the real filesystem/git. */
async function resolveSuperpowersPath(paths: GrovePaths, out: (line: string) => void): Promise<string> {
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return resolveSuperpowers({
    env: process.env,
    grovePluginsDir: join(paths.root, "plugins"),
    installedPluginsJsonPath: join(claudeConfigDir, "plugins", "installed_plugins.json"),
    fileExists: existsSync,
    readText: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
    gitClone: async (url, dest) => {
      const proc = Bun.spawn(["git", "clone", "--depth", "1", "--branch", SUPERPOWERS_REF, url, dest], { stdout: "pipe", stderr: "pipe" });
      if ((await proc.exited) !== 0) {
        const err = await new Response(proc.stderr).text();
        throw new Error(`git clone failed: ${err.trim()}`);
      }
    },
    rmDir: async (p) => {
      rmSync(p, { recursive: true, force: true });
    },
    out,
  });
}

async function launchTui(): Promise<number> {
  const paths = grovePaths();
  mkdirSync(paths.tasksDir, { recursive: true });
  const runner = new BunCommandRunner();
  const repoPath = process.cwd();
  const git = new GitRunner(runner, repoPath);
  if (!(await git.isGitRepo())) {
    console.log("not a git repository — run grove from inside your project (or `git init` first)");
    return 1;
  }
  if (!detectUsableCredential(process.env).present) {
    console.log("no Anthropic credential — run `claude login`, or set ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN)");
    return 1;
  }
  const runtimeDir = join(paths.root, "runtime");
  const claudePath = resolveClaudePath({ env: process.env, runtimeDir });
  if (!claudePath) {
    console.log("claude runtime not installed — run `grove install-runtime`");
    return 1;
  }
  const config = await loadConfig(paths);
  const store = SqliteStore.open(paths.dbFile);
  const worktrees = new GitWorktreeManager(git, paths);
  const compose = new DockerComposeManager(new DockerRunner(runner));
  const infra = new InfraManager(worktrees, compose);
  const agent = new SdkAgentRunner({ env: process.env, claudePath });
  const engine = new TaskEngine({ store, agent, infra, model: config.agent.model });
  let superpowersPath: string;
  try {
    superpowersPath = await resolveSuperpowersPath(paths, (line) => console.log(line));
  } catch (err) {
    console.log(`could not set up superpowers skills: ${err instanceof Error ? err.message : String(err)}`);
    store.close();
    return 1;
  }
  const controller = new TaskRunController(engine, repoPath, superpowersPath);
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
      const includeBlocked = argv.includes("--include-blocked");
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
        const orphans = findOrphans(candidates, { statusOf: deps.statusOf }, { includeBlocked });

        if (orphans.length === 0) {
          const hint = includeBlocked ? "" : " (use --include-blocked to also reclaim failed/blocked tasks)";
          console.log(`grove gc: nothing to reclaim.${hint}`);
          return 0;
        }
        const scope = includeBlocked ? "orphaned/blocked" : "orphaned";
        console.log(`grove gc will reclaim ${orphans.length} ${scope} task(s):`);
        for (const id of orphans) console.log(`  - ${id}`);
        if (!yes) {
          console.log("\nRe-run with --yes to reclaim them.");
          return 0;
        }
        const report = await runGc(deps, { includeBlocked });
        console.log(`\nReclaimed ${report.reclaimed.length}, kept ${report.kept.length}, errors ${report.errors.length}.`);
        for (const e of report.errors) console.log(`  ! ${e.taskId}: ${e.message}`);
        return report.errors.length === 0 ? 0 : 1;
      } finally {
        store.close();
      }
    }
    case "run": {
      const prose = argv.slice(3).filter((a) => !a.startsWith("--")).join(" ").trim();
      if (prose.length === 0) {
        console.log('grove — usage: grove run "<what you want to do>"');
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

        // Prechecks before the one-time superpowers fetch (which may hit the network).
        const hasCredential = detectUsableCredential(process.env).present;
        const hasClaudeRuntime = claudePath !== null;
        const isGitRepo = await git.isGitRepo();
        let superpowersPath = "";
        if (hasCredential && hasClaudeRuntime && isGitRepo) {
          try {
            superpowersPath = await resolveSuperpowersPath(paths, (line) => console.log(line));
          } catch (err) {
            console.log(`could not set up superpowers skills: ${err instanceof Error ? err.message : String(err)}`);
            return 1;
          }
        }

        const result = await runTask(prose, {
          engine,
          disk: new ShellDiskMonitor(runner),
          thresholds: config.disk,
          paths,
          repoPath,
          hasCredential,
          hasClaudeRuntime,
          isGitRepo,
          superpowersPath,
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
      const force = argv.includes("--force");
      const runtimeClaude = join(runtimeDir, "claude");
      const resolved = resolveClaudePath({ env: process.env, runtimeDir });
      const existing = resolved && resolved !== runtimeClaude ? resolved : null;
      return runInstallRuntime({
        platformName: process.platform,
        archName: process.arch,
        libc,
        version: CLAUDE_SDK_VERSION,
        runtimeDir,
        existing,
        force,
        envOverride: process.env.GROVE_CLAUDE_PATH ?? null,
        out: (line) => console.log(line),
        install: (platform) =>
          installRuntime({
            platform,
            version: CLAUDE_SDK_VERSION,
            runtimeDir,
            download: async (url) => {
              let lastPct = -1;
              const buf = await downloadWithProgress(url, {
                onProgress: (received, total) => {
                  const pct = Math.floor((received / total) * 100);
                  if (pct !== lastPct && (pct % 5 === 0 || pct === 100)) {
                    lastPct = pct;
                    const mb = (total / 1024 / 1024).toFixed(0);
                    process.stdout.write(`\r  downloading claude runtime (~${mb} MB)… ${pct}%`);
                  }
                },
              });
              process.stdout.write("\n");
              return buf;
            },
            verifyIntegrity: async (tgz) => {
              const pkg = platformPackage(platform);
              const meta = (await (await fetch(`https://registry.npmjs.org/${pkg}`)).json()) as any;
              const dist = meta?.versions?.[CLAUDE_SDK_VERSION]?.dist;
              if (!dist) throw new Error(`no registry metadata for ${pkg}@${CLAUDE_SDK_VERSION}`);
              const bytes = new Uint8Array(tgz);
              if (typeof dist.integrity === "string" && dist.integrity.includes("-")) {
                const [algo, expected] = dist.integrity.split("-");
                const got = new Bun.CryptoHasher(algo).update(bytes).digest("base64");
                if (got !== expected) throw new Error(`integrity mismatch for ${pkg}@${CLAUDE_SDK_VERSION}`);
              } else if (typeof dist.shasum === "string") {
                const got = new Bun.CryptoHasher("sha1").update(bytes).digest("hex");
                if (got !== dist.shasum) throw new Error(`integrity (shasum) mismatch for ${pkg}@${CLAUDE_SDK_VERSION}`);
              } else {
                throw new Error(`no integrity metadata for ${pkg}@${CLAUDE_SDK_VERSION}`);
              }
            },
            extractClaude: async (tgz, destDir) => {
              const tmp = join(destDir, "claude.tgz");
              writeFileSync(tmp, new Uint8Array(tgz));
              try {
                const proc = Bun.spawn(["tar", "-xzf", tmp, "-C", destDir, "--strip-components=1", "package/claude"], {
                  stdout: "pipe",
                  stderr: "pipe",
                });
                if ((await proc.exited) !== 0) throw new Error("failed to extract claude from the tarball");
                return join(destDir, "claude");
              } finally {
                try { unlinkSync(tmp); } catch {}
              }
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
