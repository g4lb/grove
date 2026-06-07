import type { WorktreeManager, Worktree } from "./worktree-manager.ts";
import type { ComposeManager } from "./compose-manager.ts";

export interface ProvisionResult {
  worktree: Worktree;
  composeStarted: boolean;
}

export class InfraManager {
  constructor(
    private worktrees: WorktreeManager,
    private compose: ComposeManager,
  ) {}

  /** Create the task's isolated worktree, then bring up its compose stack (if any). */
  async provision(taskId: string, title: string): Promise<ProvisionResult> {
    const worktree = await this.worktrees.create(taskId, title);
    const composeStarted = await this.compose.up(taskId, worktree.worktreePath);
    return { worktree, composeStarted };
  }

  /** Bring down the task's compose stack, then remove its worktree. */
  async teardown(taskId: string, worktreePath: string): Promise<void> {
    await this.compose.down(taskId, worktreePath);
    await this.worktrees.remove(taskId);
  }

  /** True if the session committed at least one change onto the worktree branch. */
  async committedChanges(worktreePath: string, branch: string, baseSha: string): Promise<boolean> {
    return this.worktrees.committedChanges(worktreePath, branch, baseSha);
  }
}
