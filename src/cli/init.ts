import { mkdirSync } from "node:fs";
import type { CommandRunner } from "../infra/command-runner.ts";
import type { GrovePaths } from "../config/paths.ts";
import { loadConfig, saveConfig } from "../config/config.ts";
import { SqliteStore } from "../store/sqlite-store.ts";
import { GitRunner } from "../infra/git-runner.ts";
import { runDoctor, type DoctorReport } from "./doctor.ts";

export interface InitOptions {
  runner: CommandRunner;
  paths: GrovePaths;
  repoPath: string;
}

export interface InitResult {
  ok: boolean;
  isGitRepo: boolean;
  doctor: DoctorReport;
}

export async function runInit(opts: InitOptions): Promise<InitResult> {
  const { runner, paths, repoPath } = opts;

  // 1. Create ~/.grove and tasks/ (idempotent).
  mkdirSync(paths.tasksDir, { recursive: true });

  // 2. Open/create the SQLite db (constructor runs migrations).
  SqliteStore.open(paths.dbFile).close();

  // 3. Write a default config if none exists (loadConfig returns defaults when absent).
  const config = await loadConfig(paths);
  await saveConfig(paths, config);

  // 4. Validate the working directory is a git repo.
  const git = new GitRunner(runner, repoPath);
  const isGitRepo = await git.isGitRepo();

  // 5. Run dependency preflight.
  const doctor = await runDoctor(runner);

  return { ok: isGitRepo && doctor.ok, isGitRepo, doctor };
}
