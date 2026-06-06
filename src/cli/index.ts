#!/usr/bin/env bun
import { runDoctor } from "./doctor.ts";
import { BunCommandRunner } from "../infra/command-runner.ts";
import { runInit } from "./init.ts";
import { resolvePaths } from "../config/paths.ts";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { SqliteStore } from "../store/sqlite-store.ts";
import { DockerRunner } from "../infra/docker-runner.ts";
import { GitRunner } from "../infra/git-runner.ts";
import { GitWorktreeManager } from "../infra/worktree-manager.ts";
import { DockerComposeManager } from "../infra/compose-manager.ts";
import { runGc, gcDeps, findOrphans } from "./gc.ts";

const VERSION = "0.0.1";

function printUsage(): void {
  console.log("grove — usage: grove [init | gc [--yes] | doctor | --version]");
}

function grovePaths() {
  const root = process.env.GROVE_HOME ?? join(homedir(), ".grove");
  return resolvePaths(root);
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[2];
  switch (cmd) {
    case "-v":
    case "--version":
      console.log(VERSION);
      return 0;
    case "doctor": {
      const report = await runDoctor(new BunCommandRunner());
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
    default:
      printUsage();
      return 0;
  }
}

main(process.argv).then((code) => process.exit(code));
