/** Minimal provision result the engine needs (the real InfraManager.ProvisionResult satisfies this). */
export interface ProvisionedWorktree {
  taskId: string;
  worktreePath: string;
  branch: string;
}
export interface TaskProvisionResult {
  worktree: ProvisionedWorktree;
  composeStarted: boolean;
}

/** Provision/teardown the isolated environment for a task. InfraManager satisfies this structurally. */
export interface TaskInfra {
  provision(taskId: string, title: string): Promise<TaskProvisionResult>;
  teardown(taskId: string, worktreePath: string): Promise<void>;
}
