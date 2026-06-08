/** Minimal provision result the engine needs (the real InfraManager.ProvisionResult satisfies this). */
interface ProvisionedWorktree {
  taskId: string;
  worktreePath: string;
  branch: string;
  /** The repo HEAD SHA the worktree branched from, used to detect whether the session committed anything. */
  baseSha: string;
}
export interface TaskProvisionResult {
  worktree: ProvisionedWorktree;
  composeStarted: boolean;
}

/** Provision/teardown the isolated environment for a task. InfraManager satisfies this structurally. */
export interface TaskInfra {
  provision(taskId: string, title: string): Promise<TaskProvisionResult>;
  teardown(taskId: string, worktreePath: string): Promise<void>;
  /** True if `<branch>` has at least one commit ahead of the base SHA it branched from. */
  committedChanges(worktreePath: string, branch: string, baseSha: string): Promise<boolean>;
}
