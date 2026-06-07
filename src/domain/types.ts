export type TaskKind = "task" | "issue";

export type TaskStatus =
  | "running"
  | "waiting_confirm"
  | "blocked"
  | "done"
  | "stopped";

/** A task runs as a single autonomous session; the store keeps one phase row per task. */
export type Phase = "session";

export type PhaseState = "pending" | "running" | "succeeded" | "failed";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  kind: TaskKind;
  status: TaskStatus;
  currentPhase: Phase;
  repoPath: string;
  worktreePath: string | null;
  branch: string | null;
  composeProject: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface PhaseRun {
  id: string;
  taskId: string;
  phase: Phase;
  state: PhaseState;
  summary: string | null;
  artifactPath: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  ts: string; // ISO 8601
  type: string;
  payload: string; // JSON-encoded string
}
