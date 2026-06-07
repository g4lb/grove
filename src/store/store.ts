import type {
  Task,
  PhaseRun,
  TaskEvent,
  TaskKind,
  TaskStatus,
  Phase,
  PhaseState,
} from "../domain/types.ts";

export interface CreateTaskInput {
  title: string;
  description?: string;
  kind: TaskKind;
  repoPath: string;
  status?: TaskStatus; // default "running"
  currentPhase?: Phase; // default "session"
}

export interface TaskPatch {
  status?: TaskStatus;
  currentPhase?: Phase;
  worktreePath?: string | null;
  branch?: string | null;
  composeProject?: string | null;
}

export interface TaskQuery {
  status?: TaskStatus;
}

export interface CreatePhaseRunInput {
  taskId: string;
  phase: Phase;
  state?: PhaseState; // default "pending"
}

export interface PhaseRunPatch {
  state?: PhaseState;
  summary?: string | null;
  artifactPath?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

export interface AppendEventInput {
  taskId: string;
  type: string;
  payload: unknown;
}

export interface Store {
  createTask(input: CreateTaskInput): Task;
  getTask(id: string): Task | null;
  queryTasks(query?: TaskQuery): Task[];
  updateTask(id: string, patch: TaskPatch): Task;

  createPhaseRun(input: CreatePhaseRunInput): PhaseRun;
  updatePhaseRun(id: string, patch: PhaseRunPatch): PhaseRun;
  getPhaseRuns(taskId: string): PhaseRun[];

  appendEvent(input: AppendEventInput): TaskEvent;
  getEvents(taskId: string): TaskEvent[];

  close(): void;
}
