import type { TaskStatus } from "../domain/types.ts";

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
