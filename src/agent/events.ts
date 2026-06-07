/** A streamed event emitted while an agent session runs. */
export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool_use"; tool: string; input: unknown }
  | { type: "notice"; message: string };

/** Everything an autonomous session needs. `worktreePath` is the agent's cwd. */
export interface SessionContext {
  taskId: string;
  title: string;
  prose: string;
  worktreePath: string;
  branch: string;
  model: string;
  superpowersPath: string;
}

export interface SessionResult {
  success: boolean;
  summary: string;
  costUsd: number;
  sessionId: string | null;
}
