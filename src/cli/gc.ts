import { existsSync, readdirSync } from "node:fs";
import type { TaskStatus } from "../domain/types.ts";
import type { GrovePaths } from "../config/paths.ts";
import type { Store } from "../store/store.ts";
import type { DockerRunner } from "../infra/docker-runner.ts";
import type { WorktreeManager } from "../infra/worktree-manager.ts";
import type { ComposeManager } from "../infra/compose-manager.ts";
import { composeProjectFor } from "../infra/compose-manager.ts";

/** Lookup of a task's status by id; null when the task is absent from the store. */
export interface TaskStatusLookup {
  statusOf(taskId: string): TaskStatus | null;
}

const TERMINAL: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["done", "stopped"]);

/**
 * Given candidate task ids discovered on disk / as compose projects, return the ids
 * that are safe to reclaim: those absent from the store, or in a terminal state.
 * Never reclaims running / waiting_confirm / blocked tasks.
 */
export function findOrphans(candidateIds: string[], lookup: TaskStatusLookup): string[] {
  const seen = new Set<string>();
  const orphans: string[] = [];
  for (const id of candidateIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const status = lookup.statusOf(id);
    if (status === null || TERMINAL.has(status)) {
      orphans.push(id);
    }
  }
  return orphans;
}

/** Injectable side-effects for runGc, so the reconciliation loop is unit-testable. */
export interface GcDeps {
  discover(): Promise<string[]>;
  statusOf(taskId: string): TaskStatus | null;
  removeWorktree(taskId: string): Promise<void>;
  downProject(project: string): Promise<boolean>;
}

export interface GcReport {
  reclaimed: string[];
  kept: string[];
  errors: Array<{ taskId: string; message: string }>;
}

export async function runGc(deps: GcDeps): Promise<GcReport> {
  const candidates = await deps.discover();
  const orphans = findOrphans(candidates, { statusOf: deps.statusOf });
  const orphanSet = new Set(orphans);

  const report: GcReport = { reclaimed: [], kept: [], errors: [] };
  for (const id of new Set(candidates)) {
    if (!orphanSet.has(id)) {
      report.kept.push(id);
      continue;
    }
    try {
      const downOk = await deps.downProject(composeProjectFor(id));
      if (!downOk) {
        // Teardown did not complete cleanly (e.g. docker unavailable or a container
        // that won't stop). Do NOT remove the worktree — leave it so the next gc run
        // rediscovers and retries — and surface the failure so the exit code is honest.
        report.errors.push({
          taskId: id,
          message: "docker compose down did not complete; leaving worktree for retry",
        });
        continue;
      }
      await deps.removeWorktree(id);
      report.reclaimed.push(id);
    } catch (err) {
      report.errors.push({ taskId: id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return report;
}

/**
 * Enumerate candidate task ids from on-disk worktree dirs and grove- compose projects.
 * Used to build the real GcDeps; kept separate so runGc stays unit-testable.
 */
export async function discoverTaskIds(paths: GrovePaths, docker: DockerRunner): Promise<string[]> {
  const ids = new Set<string>();

  if (existsSync(paths.tasksDir)) {
    for (const entry of readdirSync(paths.tasksDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("task_")) ids.add(entry.name);
    }
  }

  try {
    const out = await docker.docker(["compose", "ls", "--all", "--format", "json"]);
    const projects = JSON.parse(out) as Array<{ Name?: string }>;
    for (const p of projects) {
      const name = p.Name ?? "";
      if (name.startsWith("grove-task_")) ids.add(name.slice("grove-".length));
    }
  } catch {
    // docker not available / no projects — disk sweep still applies.
  }

  return [...ids];
}

/** Build real GcDeps wired to the store, worktree manager, and compose manager. */
export function gcDeps(
  paths: GrovePaths,
  store: Store,
  docker: DockerRunner,
  worktrees: WorktreeManager,
  compose: ComposeManager,
): GcDeps {
  return {
    discover: () => discoverTaskIds(paths, docker),
    statusOf: (taskId) => store.getTask(taskId)?.status ?? null,
    removeWorktree: (taskId) => worktrees.remove(taskId),
    downProject: (project) => compose.downByProject(project),
  };
}
